#!/usr/bin/env node
'use strict';
var chalk = require('chalk');
var path = require("path").posix;
var wrench = require("wrench");
var writeJsonFile = require('write-json-file');
var cliArgs = require('command-line-args');
var option_prompt = require('prompt-sync')({
    sigint: true
});
var changeCase = require('change-case');
var SC_SEPARATOR = "__";

var [,, ... args] = process.argv;
var script = args[0] || "";
process.argv.shift();

if (script === "import") {
    require('../cloudcms-import');
    return;
} else if (script === "export") {
    require('../cloudcms-export');
    return;
} else if (script === "export-users") {
    require('../cloudcms-user-export');
    return;
} else if (script === "init") {
    init(handleOptions(script));
    return;
} else if (script === "create-definition") {
    createDefinition(handleOptions(script));
    return;
} else if (script === "create-form-fields") {
    createFormFields(handleOptions(script));
    return;
} else if (script === "create-node") {
    createNode(handleOptions(script));
    return;
} else if (script === "-h" || script === "--help") {
    printHelp(handleOptions(script));
    return;
} else {
    console.log(chalk.red("Unknown command " + script));
    printHelp();
    return;
}

function printHelp() {
    console.log(chalk.blue("Supported commands are: ") + chalk.green("\n\tinit\n\timport\n\texport\n\texport-users\n\tcreate-definition\n\tcreate-form-fields\n\tcreate-node"));
}

function init(options) {
    var dataPath = options['data-path'];
    if (!dataPath) {
        dataPath = option_prompt('Enter data path (ex. ./data): ');
    }

    if (dataPath) {
        wrench.mkdirSyncRecursive(path.resolve(process.cwd(), path.normalize(dataPath), 'nodes'));
        wrench.mkdirSyncRecursive(path.resolve(process.cwd(), path.normalize(dataPath), 'definitions'));
        wrench.mkdirSyncRecursive(path.resolve(process.cwd(), path.normalize(dataPath), 'related'));
    } else {
        console.log(chalk.red("bad path: " + dataPath));
    }
}

function createDefinition(options) {
    var dataPath = options['data-path'] || "data";
    var defPath;

    if (dataPath) {
        defPath = path.resolve(process.cwd(), path.normalize(dataPath), 'definitions');
        wrench.mkdirSyncRecursive(defPath);
        wrench.mkdirSyncRecursive(path.resolve(process.cwd(), path.normalize(dataPath), 'nodes'));
        wrench.mkdirSyncRecursive(path.resolve(process.cwd(), path.normalize(dataPath), 'related'));
    } else {
        console.log(chalk.red("bad path: " + dataPath));
    }

    var node = emptyDefinitionNode();
    node._qname = option_prompt('Enter qname: ');
    node.title = option_prompt('Enter title: ');
    node.description = option_prompt('Enter description: ');

    defPath = path.resolve(defPath, node._qname.replace(':', SC_SEPARATOR));

    wrench.mkdirSyncRecursive(defPath);
    writeJsonFile.sync(path.resolve(defPath, "node.json"), node);

    var formNode = emptyFormNode();
    formNode.title = node.title;
    formNode.description = node.description;

    wrench.mkdirSyncRecursive(path.resolve(defPath, "forms"));
    writeJsonFile.sync(path.resolve(defPath, "forms", "master.json"), formNode);
}

function createFormFields(options) {
    var dataPath = options['data-path'] || "data";
    var definitionQName = options["definition-qname"];
    var overwrite = options["overwrite"];

    if (!definitionQName) {
        console.log(chalk.red("Bad or missing type qname: " + definitionQName));
    }

    var defPath = path.resolve(process.cwd(), path.normalize(dataPath), 'definitions', definitionQName.replace(':', SC_SEPARATOR));
    var definition = require(path.resolve(defPath, "node.json"));
    var formPath = path.resolve(defPath, "forms", "master.json");
    var form = require(formPath);

    writeFields(definition.properties, form.fields, overwrite);
    // console.log(JSON.stringify(form, null, 2));

    writeJsonFile.sync(formPath, form);
    console.log(chalk.green("Completed form: ") + formPath);
}

function writeFields(properties, fields, overwrite) {
    Object.keys(properties).forEach(function(propertyName, index) {

        var property = properties[propertyName];

        if (fields[propertyName] && !overwrite) {
            // should we overwrite the existing form field?
            console.log(chalk.red("field exists. skipping: " + propertyName));
            return;
        }

        var field = fields[propertyName] = {
            'type': 'text',
            'label': property.title || changeCase.title(property.name),
            'required': !!property.required
        };

        if (property.type === 'object') {
            field.type = 'object';
            field.fields = {};
            writeFields(property.properties, fields, overwrite);
            if (property._relator) {
                field.type = "node-picker";
                field.picker = {
                    typeQName: property.nodeType || "n:node",
                    associationType: property.associationType || "a:linked",
                    includeChildTypes: true
                };    
            }
        } else if (property.type === 'array') {
            field.type = 'array';
            if (property._relator) {
                field.type = "node-picker";
                field.picker = {
                    typeQName: property.nodeType || "n:node",
                    associationType: property.associationType || "a:linked",
                    includeChildTypes: true
                };    
            } else {
                writeFields([property.items], [field.items], overwrite);
            }
        } else if (property.type === 'string') {
            field.required = true;
            field.default = "";
            if (property.enum) {
                field.optionLabels = [];
                property.enum.forEach(function(value) {
                    field.optionLabels.push(value);
                });
            }
        } else {
            field.required = true;
            field.type = property.type;
        }
    });
}

function createNode(options) {
    var dataPath = options['data-path'] || "data";
    var defPath;

    if (dataPath) {
        defPath = path.resolve(process.cwd(), path.normalize(dataPath), 'nodes');
        wrench.mkdirSyncRecursive(defPath);
        wrench.mkdirSyncRecursive(path.resolve(process.cwd(), path.normalize(dataPath), 'definitions'));
        wrench.mkdirSyncRecursive(path.resolve(process.cwd(), path.normalize(dataPath), 'related'));
    } else {
        console.log(chalk.red("bad path: " + dataPath));
    }

    var node = emptyNode();
    node._type = option_prompt('Enter type qname: ');
    node.title = option_prompt('Enter title: ');
    node.description = option_prompt('Enter description: ');

    defPath = path.resolve(defPath, node._type.replace(':', SC_SEPARATOR));

    wrench.mkdirSyncRecursive(defPath);
    writeJsonFile.sync(path.resolve(defPath, "node.json"), node);

    wrench.mkdirSyncRecursive(path.resolve(defPath, "attachments"));
}

function emptyNode() {
    return {
        "title": "",
        "description": "",
        "_type": "",
        "type": "object",
        "_parent": "n:node",
        "properties": {
        },
        "mandatoryFeatures": {
        }
    };
}

function emptyDefinitionNode() {
    return {
        "title": "",
        "description": "",
        "_qname": "",
        "_type": "d:type",
        "type": "object",
        "_parent": "n:node",
        "properties": {
        }
    };
}

function emptyFormNode() {
    return {
        "title": "",
        "engineId": "alpaca1",
        "fields": {
        },
        "_type": "n:form"
    };
}

function handleOptions(command) {
    var options = [
        {name: 'help', alias: 'h', type: Boolean},
        {name: 'data-path', alias: 'f', type: String, defaultValue: './data', description: 'data folder path. defaults to ./data'}
    ];

    if (command === 'create-form-fields') {
        options.push(
            {name: 'definition-qname', alias: 'q', type: String, description: '_qname of the type definition'},
            {name: 'overwrite', alias: 'o', type: Boolean, description: 'Overwrite any existing fields in the form'}
        );
    }

    return cliArgs(options);
}