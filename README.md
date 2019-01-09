# Cloud CMS Command Line Utility
[![NPM Version](https://img.shields.io/npm/v/cloudcms-util.svg)](https://www.npmjs.com/package/cloudcms-util)
[![NPM Download](https://img.shields.io/npm/dm/cloudcms-util.svg)](https://www.npmjs.com/package/cloudcms-util)

Command line scripts to perform various Cloud CMS related tasks such as import and export json nodes and binary attachments to and from Cloud CMS repositories.

Not to be confused with the official Cloud CMS CLI (https://www.npmjs.com/package/cloudcms-cli)

It is not necessary to install cloudcms-util. It runs as an npx script. But it will run faster if it installed first (otherwise npx will install it on demand and remove it when it finishes executing each command).

## Install:
    npm install -g cloudcms-util

## Help:
    npx cloudcms-util -h

## List Local Definitions
    Connect to Cloud CMS and list available definition qnames',
    (requires gitana.json in the folder where the script is executed)

    npx cloudcms-util --list-types'

## Export specified defintions and content instance records
    npx cloudcms-util export --definition-qname "my:type1" "my:type2" --include-instances

    requires gitana.json in the folder where the script is executed

## Export all defintions
    npx cloudcms-util export -a
    
## Export a list of nodes based on a user defined query:
    create a mongodb query in the file ./myquery.json
    {
        "_type": "my:type1",
        "foo": "bar"
    }

    npx cloudcms-util export.js -y ./myquery.json
