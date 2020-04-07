# Cloud CMS Command Line Utility
[![NPM Version](https://img.shields.io/npm/v/cloudcms-util.svg)](https://www.npmjs.com/package/cloudcms-util)
[![NPM Download](https://img.shields.io/npm/dm/cloudcms-util.svg)](https://www.npmjs.com/package/cloudcms-util)
[![Travis Build](https://img.shields.io/travis/harrymoore/cloudcms-util)](https://img.shields.io/travis/harrymoore/cloudcms-util)

Command line scripts to perform various Cloud CMS related tasks such as import and export json nodes and binary attachments to and from Cloud CMS repositories.

Not to be confused with the official Cloud CMS CLI (https://www.npmjs.com/package/cloudcms-cli)

It is not necessary to install cloudcms-util. It runs as an npx script. But it will run faster if it installed first (otherwise npx will install it on demand and remove it when it finishes executing each command).

## Install:
It is not necessary to install this utility as it will run as an npx script. But you can install it to so it runs withouth first downloading:
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

## Import users from a CSV file to the primary platform domain. Optionally add the users to a project.

    npx cloudcms-util import-users -g ./gitana/gitana-local.json --csv-source ./data/users-test1.csv --default-password "This13ThePassword" --project-id 5751b6235492fef8614d --team-key project-managers-team --username admin --password admin

Adding users is a platform operation and requires admin privileges. Use either --prompt or --username and --password to enter credentials of a user with sufficient platform privileged.

If the user already exists in the platform it will not be modified. Therefor you can run this import process over and over again to ensure missing users are created or to add the users to a different project and/or project team.

Users require a password. If the PASSWORD column is empty for any user then the user will be skipped. Unless you use the --default-password option. If both are present then the PASSWORD column value takes precedence.

The CSV file is required to have a header as the first row. The headers should be: NAME,EMAIL,FIRST,LAST,COMPANY,PASSWORD. The header text does not actually matter. The first column is expeced to me NAME, the second column EMAIL, etc.
Example: 
NAME,EMAIL,FIRST,LAST,COMPANY,PASSWORD
mary,mary.user1@email.com,Marry,User1,this company,
edith,edith.m.user2@anotheremail.com,Edith,User2,,Hello$World.1

## Apply bulk property updates
```
npx cloudcms-util patch-nodes -g ./gitana/gitana-local-docker-test-proxy.json --csv-source ./data/patch-test1.csv --overwrite -v
```
