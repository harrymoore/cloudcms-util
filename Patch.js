#!/usr/bin/env node
/*jshint esversion: 8 */
/*jshint -W069 */
const BaseScript = require('./lib/BaseScript.js');
const objectPath = require("object-path");
const chalk = require('chalk');
const Logger = require('basic-logger');
const log = new Logger({
    showMillis: false,
    showTimestamp: true
});

module.exports =
class Patch extends BaseScript {
    constructor() {
        super(defaultOptions, defaultHelpMessage);
    }

    /** exec()
     * entry point 
    */
    async exec() {
        log.info("handlePatch()");

        await this.connect();

        log.info(chalk.yellow("Connected to project: \"" + this.project.title + "\" and branch: " + this.branch.title || this.branch._doc));

        this.option_queryFilePath = this.options["query-file-path"] || null;
        this.option_reportOnly = this.options["report-only"] || false;
        this.option_overwrite = this.options["overwrite"] || false;
        this.option_propertyPath = this.options["property-path"];
        this.option_newPropertyPath = this.options["new-property-path"];
        this.option_propertyValue = this.options["property-value"];
        this.option_opMove = this.options["move"] || false;
        this.option_opReplace = this.options["replace"] || false;
        this.option_opCopy = this.options["copy"] || false;
        this.option_opRemove = this.options["remove"] || false;
        this.option_opAdd = this.options["add"] || false;

        let query = require(this.option_queryFilePath);
        if ((this.option_opMove || this.option_opReplace || this.option_opCopy || this.option_opRemove) && !query[this.option_propertyPath]) {
            // if doing a move, copy, replace or remove then only need to query for nodes that have the property now
            query[this.option_propertyPath.split('/').join('.')] = {
                '$exists': true
            };
        }
        query._fields = {};
        query._fields[this.option_propertyPath.split('/').join('.')] = 1;

        let result = await this.session.queryNodes(this.repository, this.branch, query, {metadata: true, full: true, limit: -1});

        if (this.option_reportOnly) {
            result.rows.forEach(element => {
                log.info(`${element._doc} ${this.option_propertyPath} : ${objectPath.get(element, this.option_propertyPath)}`);
            });
        }
        else if (this.option_opMove || this.option_opReplace || this.option_opCopy || this.option_opRemove || this.option_opAdd) 
        {
            this.handlePatch(result.rows, this.option_opMove ? "move" : this.option_opReplace ? "replace" : this.option_opCopy ? "copy" : this.option_opRemove ? "remove" : this.option_opAdd ? "add" : null);
        } 
        else 
        {
            printHelp(getOptions());
        }
    }

    async handlePatch(nodes, op) {
        log.debug("handlePatch()");
        log.info("Operation: " + op);

        if (!op) {
            throw `Patch operation (op): ${op} not valid`;
        }
        
        let patches = nodes.map(node => {
            let patch = {
                node: node._doc,
                patch: {
                    op: op,
                    path: '/' + this.option_propertyPath.split('.').join('/').split('/').join('/'), // ensure property path is formatted
                }
            };

            switch (op) {
                
                case 'add':
                case 'replace':
                    patch.patch.value = option_propertyValue;
                    break;
                
                case 'copy':
                case 'move':
                    patch.patch.from = '/' + this.option_propertyPath.split('.').join('/').split('/').join('/'); // ensure property path is formatted
                    patch.patch.path = '/' + this.option_newPropertyPath.split('.').join('/').split('/').join('/'); // ensure property path is formatted
                    break;
            }

            return patch;
        });
    

        log.debug("Patches: " + JSON.stringify(patches, null, 2));
    
        patches.forEach(patch => {
            this.session.patchNode(this.repository, this.branch, patch.node, [patch.patch]);
        });
    }
    
};

const defaultOptions = [
    {
        name: 'report-only',
        type: Boolean,
        default: false,
        description: 'read nodes listed in the csv file and report the current value of the property. No node updates are made.'
    },
    {
        name: 'query-file-path', 
        alias: 'y', 
        type: String,
        required: true, 
        description: 'path to a json file defining the query'
    },
    {
        name: 'move',
        type: Boolean,
        default: false,
        description: 'perform a patch "move" operation. This will rename the property in --property-path to --new-property-path'
    },
    {
        name: 'property-path',
        type: String,
        description: 'name of the JSON property to update when patching.'
    },
    {
        name: 'new-property-path',
        type: String,
        description: 'name of the JSON property to update when patching.'
    },
    {
        name: 'property-value',
        type: String,
        description: 'the new value to set for the patched property.'
    },
    {
        name: 'overwrite',
        alias: 'o',
        type: Boolean,
        default: false,
        description: 'overwrite properties that already exist. by default only missing properties will be set'
    }
];

const defaultHelpMessage = [
    {
        header: 'Cloud CMS Patch Nodes',
        content: 'Update nodes in a branch by applying an HTTP PATCH method API call. The node ids and property information should be supplied in a CSV file.'
    },
    {
        header: 'Options',
        optionList: this.mergedOptions
    },
    {
        header: 'Examples',
        content: [{
            desc: '\n1. Report current property values for nodes found in query results:',
        },
        {
            desc: 'npx cloudcms-util patch --report-only --property-path "/body" --query-file-path ./patch-test1.json'
        },
        {
            desc: '\n2. Apply updates for nodes found in query results:',
        },
        {
            desc: 'npx cloudcms-util patch --move --property-path "/body" --new-property-path "/body" --query-file-path ./patch-test1.json'
        }
        ]
    }
];
