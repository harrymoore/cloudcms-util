# npx script: cloudcms-util
## Nodejs command line scripts to perform various Cloud CMS related tasks such as import and export json nodes and binary attachments to and from Cloud CMS repositories.

It is not necessary to install cloudcms-util because it runs as an npx script. But it will run faster if it installed first (otherwise npx will install it on demand and remove it when it finishes executing each command).

## install:
    npm install -g cloudcms-util

## help:
    npx cloudcms-util -h

## Command list
    npx export -h
    npx import -h
    
## Export:
### Export defintions and content instance records from a Cloud CMS project branch

connect to Cloud CMS and list available definition qnames',
                },
                {
                    desc: 'node cloudcms-export.js --list-types'
                },
                {
                    desc: '2. export definitions and content records by qname:',
                },
                {
                    desc: 'node cloudcms-export.js --definition-qname "my:type1" "my:type2" --include-instances --folder-path ./data'
                },
                {
                    desc: '3. export a list of nodes based on a user defined query:',
                },
                {
                    desc: 'node cloudcms-export.js -y ./myquery.json --folder-path ./data'
                }
            ]
