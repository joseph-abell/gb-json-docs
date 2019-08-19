# Giantbomb JSON Docs

I want to use the Giantbomb documentation as config for a GraphQL API, but they only provided it as a html format.
This script takes the html and converts it into JSON. I have a cron job running on netlify to check for updates every
24 hours, so we will track changes just fine.

## Todo and caveats.

As long as GB don't change their html structure, this should by pretty stable. If they do change the structure,
this will break spectacularly. In order to fight against that I'll need to provide a cached version of the file.
