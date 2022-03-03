#!/usr/bin/env node
/*jshint esversion: 8 */
/*jshint -W069 */

const BaseScript = require('./lib/BaseScript.js');
const objectPath = require("object-path");
const chalk = require('chalk');
const Logger = require('basic-logger');
const log = new Logger({
    showMillis: false,
    showTimestamp: false
});
Logger.setLevel('info', true);

// For each node, grabe it's changeset it and verify that the changeset exists. If not then refresh the node

module.exports = class FindMissingChangesets extends BaseScript {
    constructor() {
        super(defaultOptions, defaultHelpMessage);
    }

    /** exec()
     * entry point 
    */
    async exec() {
        await this.connect();

        log.info(chalk.yellow("Connected to project: \"" + this.project.title + "\" and branch: " + this.branch.title || this.branch._doc));

        this.option_queryFilePath = this.options["query-file-path"] || null;
        this.option_refreshNodes = this.options["refresh-nodes"] || false;

        let query = {};
        if (this.option_queryFilePath) {
            query = require(this.option_queryFilePath);
        }
        query._fields = {
            "_system.changeset": 1
        };

        let offset = 0;
        let limit = 50;

        while (true) {
            let result = await this.session.queryNodes(this.repository, this.branch, query, { metadata: true, full: true, limit: limit, offset: offset });
            result.rows.forEach(async node => {
                // log.info(`${node._doc}: ${node._system.changeset}`);

                // check for valid changeset id
                let changeset = await this.session.readChangeset(this.repository, node._system.changeset);
                if (changeset && changeset._doc) {
                    // log.info(`${node._doc}: ${node._system.changeset}`);
                    // log.info(`\t${JSON.stringify(changeset, null, 2)}`);
                } else {
                    log.info(`\tchangeset ${node._system.changeset} not found for node ${node._doc}`);

                    if (this.option_refreshNodes) {
                        log.info('\trefreshing node...');
                        this.session.refreshNode(this.repository, this.branch, patch.node);
                    }
                }
            });

            offset += limit;
            log.info(`Checked ${offset} of ${result.total_rows} nodes`);
            if (result.total_rows <= offset) {
                break;
            }
        }

        log.info("Done");
    }
};

const defaultOptions = [
    {
        name: 'query-file-path',
        alias: 'y',
        type: String,
        required: true,
        description: 'path to a json file defining the query'
    },
    {
        name: 'refresh-nodes',
        type: Boolean,
        default: false,
        description: 'if true only list nodes with missing changesets (don\'t call refresh). If true, call refresh for those nodes'
    }
];

const defaultHelpMessage = [
    {
        header: 'Cloud CMS Patch Nodes',
        content: 'Update nodes in a branch by applying an HTTP PATCH method API call. The nodes to update are identified by a provided query.'
    },
    {
        header: 'Examples',
        content: [{
            desc: '\n1. Report nodes with missing changeset:',
        },
        {
            desc: 'npx cloudcms-util find-missing-changesets'
        },
        {
            desc: '\n2. Call refresh api for nodes with missing changeset:',
        },
        {
            desc: 'npx cloudcms-util find-missing-changesets --refresh-nodes'
        }
        ]
    }
];
