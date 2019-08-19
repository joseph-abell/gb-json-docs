/* eslint-disable */
const fetch = require('node-fetch');
const jsdom = require('jsdom');
const fs = require('fs');
const { JSDOM } = jsdom;

const getInfoFromSubgroups = (rawValues) => {
	let url;
	let description;

	let subgroups = rawValues.reduce((acc, subgroup) => {
		const lastSubgroup = acc.length > 0 ? acc[acc.length - 1] : {};
		const subgroupsMinusLastSubgroup = acc.length > 0 ? acc.slice(0, -1) : [];

		const tdCount = subgroup.match(/\<td[\s\S]*?>[\s\S]*?\<\/td\>/g).length;

		if (tdCount === 1) {
			const singleTd = subgroup
				.split('<tr>')
				.join('')
				.split('</tr>')
				.join('')
				.split('<td colspan="4">')
				.join('')
				.split('<td colspan="2">')
				.join('')
				.split('</td>')
				.join('');

			// We have url, which belongs to the group. assign it to a variable above and continue on.
			if (singleTd.includes('URL:')) {
				url = singleTd.split('URL: ').join('').split('<strong>').join('').split('</strong>').join('').trim();

				return acc;
			}

			// Description belongs to group, assign it to a variable and move on.
			if (singleTd.includes('Description')) {
				description = singleTd
					.split('<strong>Description:</strong')
					.join('')
					.split('<p>')
					.join('')
					.split('</p>')
					.join('');
				return acc;
			}

			// Anything left should be the subgroup title.
			const subgroupTitle = singleTd.split('<strong>').join('').split('</strong>').join('');
			lastSubgroup.title = subgroupTitle;
			lastSubgroup.items = [];

			return [ ...subgroupsMinusLastSubgroup, lastSubgroup ];
		}

		if (tdCount === 2) {
			const item = subgroup.split('<tr>').join('').split('</tr>').join('').trim().split('  ').join('');
			const [ , ...rest ] = item.split(/\<td[\s\S]*?\>/g);
			const [ key, value ] = rest.map((i) =>
				i.split('\n').join('').split('</td>').join('').split('</tr>').join('').trim()
			);
			lastSubgroup.items = [ ...lastSubgroup.items, { key, value, sortable: false, filterable: false } ];
			return [ ...subgroupsMinusLastSubgroup, lastSubgroup ];
		}

		if (tdCount === 3) {
			const subgroupTitle = subgroup
				.split('<td')[1]
				.split(' colspan="2">')
				.join('')
				.split('</td>')
				.join('')
				.split('<strong>')
				.join('')
				.split('</strong>')
				.join('');

			return [ ...acc, { title: subgroupTitle, items: [] } ];
		}

		if (tdCount === 4) {
			const [ , ...rows ] = subgroup.split('<td>');
			const [ key, value, sortable, filterable ] = rows.map((row) =>
				row.split('</td>').join('').split('\n').join('').split('</tr>').join('').trim()
			);
			lastSubgroup.items = [
				...lastSubgroup.items,
				{ key, value, sortable: !!sortable, filterable: !!filterable }
			];
			return [ ...subgroupsMinusLastSubgroup, lastSubgroup ];
		}

		return acc;
	}, []);

	return [ url, description, subgroups ];
};

// Used to build up resources, which have a more complex structure.
const getGroups = (rawString) => {
	// once again, removing the first one as I've accidentally created a broken first item
	// when splitting the subgroups apart
	const [ , ...groups ] = rawString.split(/\<h3[\s\S]*?\>/g).map((i) => `<main><h3>${i}</main>`);
	return groups.map((group) => {
		// Subgroups are pretty complex: we can have a subtitle, a url field,
		// a subsubgroup, of which each item has a key, value, and can
		// potentially be filtered and sorted if it is a field.

		const { window: { document } } = new JSDOM(group);
		const title = document.getElementsByTagName('h3')[0].innerHTML;

		const rawString = document.getElementsByTagName('table')[0].innerHTML;
		const rawValues = rawString.match(/\<tr>[\s\S]*?\<\/tr\>/g);
		let [ url, description, subgroups ] = getInfoFromSubgroups(rawValues);
		if (!description) description = '';

		let fields;
		let filters;

		subgroups = subgroups.map((subgroup) => {
			if (subgroup.title === 'Fields') {
				fields = subgroup.items;
			}

			if (subgroup.title === 'Filters') {
				subgroup.items = subgroup.items.map((item) => {
					delete item.filterable;
					delete item.sortable;
					return item;
				});
				filters = subgroup.items;
			}

			return subgroup;
		});

		return { title, url, description, filters, fields };
	});
};

// Used for building up responses. We split the string based on instances of td elements to get
// the component parts.
const getItems = (rawValues) =>
	rawValues
		.map((rawValue) =>
			rawValue.match(/\<td>[\s\S]*?\<\/td\>/g).map((i) => i.split('<td>').join('').split('</td>').join(''))
		)
		.reduce((acc, [ key, value ]) => ({ ...acc, [key]: value }), {});

const getTypes = (container) => {
	// Now some more gross regex to separate the two different sections of the docs.
	// I'm doing an array destructure to throw away the unneeded first item.
	let [ , ...types ] = container.split(/\<h2/g).map((i) => `<main><h2${i}</main>`);

	// Now we have our groups, we need to manipulate the strings to give us json back
	// The hardest part here is that each group looks slightly different.
	// The first group has a main title, and data. For the second group, we have subgroups

	return types.map((type) => {
		const { window: { document } } = new JSDOM(type);
		const title = document.getElementsByTagName('h2')[0].innerHTML;
		const rawString = document.getElementsByTagName('main')[0].innerHTML;

		// Getting all subsections by grabbing h3 tags. if we don't have any, we are in
		// A simple group with a title and values. If we do we have subtitles also.
		if (!rawString.match(/\<h3/g)) {
			const rawValues = rawString.match(/\<tr>[\s\S]*?\<\/tr\>/g);
			const items = getItems(rawValues);
			return { title, items };
		}

		const groups = getGroups(rawString);
		return { title, groups };
	});
};

(async () => {
	try {
		const response = await fetch('https://giantbomb.com/api/documentation');

		if (!response.ok) {
			throw new Error({ statusCode: response.status, body: response.statusText });
		}

		const data = await response.text();

		// JSDOM had trouble parsing the styling, so I'm using a few regexs here to remove styling and scripts
		const regexs = [ /\<script[\s\S]*?\>[\s\S]*?\<\/script\>/g, /\<style\>[\s\S]*?\<\/style\>/g ];
		const cleanData = regexs.reduce((acc, reg) => {
			return acc.split(reg).join('');
		}, data);

		// JSDOM now works as intended. The next job is to get only the HTML I care about.
		// First I'll get the element that contains all the data I need.
		const { window: { document } } = new JSDOM(cleanData);
		const container = document.getElementsByClassName('js-toc-content')[0].innerHTML;

		const types = getTypes(container);

		const body = JSON.stringify(types, null, 2);
		fs.writeFileSync('index.json', body, 'utf8');
	} catch (err) {
		console.log(err);
	}
})();
