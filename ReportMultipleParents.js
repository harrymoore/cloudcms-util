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
    class DetectMultipleParents extends BaseScript {
        constructor() {
            super(defaultOptions, defaultHelpMessage);
        }

        /** exec()
         * entry point 
        */
        async exec() {
            await this.connect();
            this.gitanaConfig
            log.info(chalk.yellow("Connected to project: \"" + this.project.title + "\" and branch: " + this.branch.title || this.branch._doc));

            this.option_queryFilePath = this.options["query-file-path"] || null;
            this.option_reportOnly = this.options["report-only"] || false;

            let query = require(this.option_queryFilePath);
            // query._fields = {};

            let result = await this.session.queryNodes(this.repository, this.branch, query, { metadata: true, full: true, limit: 2000 });

            let reportData = {};
            result.rows.forEach(element => {
                log.debug(`association: ${element._doc}, source: ${element.source} (${element.source_type}), target: ${element.target} (${element.target_type})`);

                if (element.target && reportData[element.target] !== undefined) {
                    reportData[element.target].push(element.source);
                } else {
                    reportData[element.target] = [element.source];
                }
            });

            // filter out single parented nodes
            // result.rows.forEach(element => {
            //     if (reportData[element.target].length == 1) {
            //         delete reportData[element.target];
            //     }
            // });

            console.log("Done");

            if (this.option_reportOnly) {
                console.log(JSON.stringify(reportData,null,2));
            } else {
                printHelp(getOptions());
            }
        }

        async handle(nodes, op) {
            log.debug("handle()");
        }
    };

const defaultOptions = [
    {
        name: 'report-only',
        type: Boolean,
        default: false,
        description: 'Only report results. No node updates are made.'
    },
    {
        name: 'query-file-path',
        alias: 'y',
        type: String,
        required: true,
        description: 'path to a json file defining the query'
    }
];

const defaultHelpMessage = [
    {
        header: 'Cloud CMS - Report Nodes with Mulitple Parents (a:child)',
        content: 'Update nodes in a branch by applying an HTTP PATCH method API call. The nodes to update are identified by a provided query.'
    },
    {
        header: 'Examples',
        content: [{
            desc: '\n1. Report nodes found in a query:',
        },
        {
            desc: 'npx cloudcms-util report-multiple-parents --report-only --query-file-path ./query-test1.json'
        }
        ]
    }
];
