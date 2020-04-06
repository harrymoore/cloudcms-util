/*jshint esversion: 8 */
/*jshint -W032 */

const cloudcms = require("cloudcms");
const util = require('./util');
const fs = require('fs');
const path = require('path');
const cliArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');
const _ = require('underscore');
const Logger = require('basic-logger');

module.exports = class Script {

    constructor(commandOptions = [], helpMessages = []) {
        this.mergedOptions = defaultOptions.concat(commandOptions);
        this.helpMessages = helpMessages;

        //set OS-dependent path resolve function 
        this.isWindows = /^win/.test(process.platform);
        this.pathResolve = this.isWindows ? path.resolve : path.posix.resolve;

        // debug feature. only use when using charles proxy ssl proxy for intercepting cloud cms api calls:
        // if (process.env.NODE_ENV !== "production") {
        //     process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
        // }

        this.handleOptions();
        if (!this.options) {
            return;
        }

        if (this.options.verbose) {
            Logger.setLevel('debug', true);
        } else {
            Logger.setLevel('info', true);
        }

        this.option_prompt = this.options.prompt;
        this.option_useCredentialsFile = this.options["use-credentials-file"];
        this.option_gitanaFilePath = this.options["gitana-file-path"] || "./gitana.json";
        this.option_branchId = this.options.branch || "master";

        //
        // load gitana.json config and override credentials
        //
        this.gitanaConfig = JSON.parse("" + fs.readFileSync(this.option_gitanaFilePath));
        if (this.option_useCredentialsFile) {
            // override gitana.json credentials with username and password properties defined in the cloudcms-cli tool local db
            let rootCredentials = JSON.parse("" + fs.readFileSync(path.join(util.homeDirectory(), ".cloudcms", "credentials.json")));
            this.gitanaConfig.username = rootCredentials.username;
            this.gitanaConfig.password = rootCredentials.password;
        } else if (this.option_prompt) {
            // override gitana.json credentials with username and password properties entered at command prompt
            var option_prompt = require('prompt-sync')({
                sigint: true
            });
            this.gitanaConfig.username = option_prompt('name: ');
            this.gitanaConfig.password = option_prompt.hide('password: ');
        }; // else don't override credentials
    };

    async connect() {
        this.session = await cloudcms.connect(this.gitanaConfig);
        this.application = await this.session.readApplication(this.gitanaConfig.application);
        this.project = await this.session.readProject(this.application.projectId);
        this.stack = await this.session.readStack(this.project.stackId);
        this.dataStores = await this.session.listDataStores(this.stack);
        this.dataStoresById = _.indexBy(this.dataStores.rows, '_doc');
        this.repository = this.dataStoresById.content;
        this.repository._doc = this.repository.datastoreId;
        this.branchList = await this.session.listBranches(this.repository);
        this.branchesById = _.indexBy(this.branchList.rows, '_doc');
        this.branchesByTitle = _.indexBy(this.branchList.rows, 'title');
        this.branch = await this.session.readBranch(this.repository.datastoreId, this.option_branchId);
        this.master = await this.session.readBranch(this.repository.datastoreId, "master");
    }

    async exec() {
        throw new Error('You need to implement the the \'exec()\' method!');
    };

    getOptions() {
        return this.options;
    }

    handleOptions() {
        this.options = cliArgs(this.mergedOptions);
        if (_.isEmpty(this.options) || this.options.help) {
            console.log(commandLineUsage());
        }
    
        return;
    }
};

const defaultOptions = [{
        name: 'help',
        alias: 'h',
        type: Boolean
    },
    {
        name: 'verbose',
        alias: 'v',
        type: Boolean,
        description: 'verbose logging'
    },
    {
        name: 'prompt',
        alias: 'p',
        type: Boolean,
        description: 'prompt for username and password. overrides gitana.json credentials'
    },
    {
        name: 'use-credentials-file',
        alias: 'c',
        type: Boolean,
        description: 'use credentials file ~/.cloudcms/credentials.json. overrides gitana.json credentials'
    },
    {
        name: 'gitana-file-path',
        alias: 'g',
        type: String,
        description: 'path to gitana.json file to use when connecting. defaults to ./gitana.json'
    },
    {
        name: 'branch',
        alias: 'b',
        type: String,
        description: 'branch id (not branch name!) to write content to. branch id or "master". Default is "master"'
    }
];
