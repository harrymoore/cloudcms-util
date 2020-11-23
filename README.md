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

    npx cloudcms-util export -g ./cloudcms-files/source-repo-gitana.json -y ./myquery.json

    requires the equivalent of your project's gitana.json in this file path: ./cloudcms-files/source-repo-gitana.json

## Export nodes with translations

### First export some nodes that are already multilingual:
    create a mongodb query in the file ./myquery.json

    {
        "_type": "catalog:person",
        "_features.f:multilingual": {"$exists": true}
    }

    When working with translations you work primarily with the master nodes and use options to instruct how to deal with the translation nodes.

    The above query will select catalog:person nodes which are master nodes. Translation nodes will not be selected since they do not have the f:multilingual feature on them. Instead, use the --include-translations option to export the translations.
    
    Run the export:

    npx cloudcms-util export -g ./my-gitana.json -y ./myquery.json --folder-path ./data --include-translations

    If the nodes matching the query have any existing translations they will be exported to a 'translations' folder below the node's folder.

### A folder structure similar to the following will be created:
    ./data/
    └── nodes
        └── catalog__person
            ├── 8bb475e8cbe57d55c412
            │   ├── attachments
            │   │   └── default.jpg
            │   ├── node.json
            │   └── translations
            │       └── sv_SE
            │           ├── attachments
            │           │   └── default.jpg
            │           └── node.json
            └── 9f6c175a41df35544404
                ├── attachments
                │   └── default.jpg
                ├── node.json
                └── translations
                    └── sv_SE
                        └── node.json    

## Import new translations
You can create new translations on exisiting master nodes by create the expected folder structure with JSON and optional attachment files.

Given the previous folder structure with 2 master nodes each containing a single translation (locale sv_SE), create new translations by creating a new folder for the translation. The folder name should be the locale of the translation.

Inside this folder create node.json with the translation node's content in the new language. Do not include _doc or _qname properties in the new JSON as the script will do that.

For example here is the new folder structure after adding German translations to the existing nodes:

    ./data/
    └── nodes
        └── catalog__person
            ├── 8bb475e8cbe57d55c412
            │   ├── attachments
            │   │   └── default.jpg
            │   ├── node.json
            │   └── translations
            │       ├── de_DE
            │       │   ├── attachments
            │       │   │   └── default.jpg
            │       │   └── node.json
            │       └── sv_SE
            │           ├── attachments
            │           │   └── default.jpg
            │           └── node.json
            └── 9f6c175a41df35544404
                ├── attachments
                │   └── default.jpg
                ├── node.json
                └── translations
                    ├── de_DE
                    │   └── node.json
                    └── sv_SE
                        └── node.json

It is not necessary to include attachments in translations unless you are overriding the default from the master node.

    There are a few extra options when importing nodes with translations:

    --include-translations
    By default no 'translation' folders will be processed. You must include this option to import any translations.

    --only-translations
    Don't process master nodes. Only their translations. Use for periodically adding new translations.

    --overwrite-existing-translations
    By default, when using --include-translations, existing translations will not be overwritten. This will overwrite any existing translation nodes.

    Import only new translations:

    npx cloudcms-util import -g ./my-gitana.json --folder-path ./data --include-translations --only-translations

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
