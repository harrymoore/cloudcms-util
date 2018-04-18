#!/usr/bin/env node
/*jshint -W069 */ 
/*jshint -W104*/ 
const Gitana = require("gitana");
const fs = require("fs");
const path = require("path");
const mime = require('mime-types');
const async = require("async");
const cliArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage')
const util = require("./lib/util");
const writeJsonFile = require('write-json-file');
const loadJsonFile = require('load-json-file');
const _ = require('underscore');
const Logger = require('basic-logger');
const log = new Logger({
	showMillis: false,
	showTimestamp: true
});

//set OS-dependent path resolve function 
const isWindows = /^win/.test(process.platform);
const pathResolve = isWindows ? path.resolve : path.posix.resolve;

// debug only when using charles proxy ssl proxy when intercepting cloudcms api calls:
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var options = handleOptions();
if (!options) {
    return;
}
if (options["verbose"]) {
    Logger.setLevel('debug', true);
} else {
    Logger.setLevel('info', true);
}

var option_prompt = options["prompt"];
var option_useCredentialsFile = options["use-credentials-file"];
var option_gitanaFilePath = options["gitana-file-path"] || "./gitana.json";
var option_branchId = options["branch"] || "master";
var option_listTypes = options["list-types"];
var option_definitionQNames = options["definition-qname"]; // array
var option_includeInstances = options["include-instances"] || false;
var option_overwriteExistingInstances = options["overwrite-instances"] || false;
var option_dataFolderPath = options["folder-path"] || "./data";
var option_includeRelated = options["include-related"] || false;
var option_nodes = options["nodes"];

//
// load gitana.json config and override credentials
//
var gitanaConfig = JSON.parse("" + fs.readFileSync(option_gitanaFilePath));
if (option_useCredentialsFile) {
    // override gitana.json credentials with username and password properties defined in the cloudcms-cli tool local db
    var rootCredentials = JSON.parse("" + fs.readFileSync(path.join(util.homeDirectory(), ".cloudcms", "credentials.json")));
    gitanaConfig.username = rootCredentials.username;
    gitanaConfig.password = rootCredentials.password;
} else if (option_prompt) {
    // override gitana.json credentials with username and password properties entered at command prompt
    var option_prompt = require('prompt-sync')({
        sigint: true
    });
    gitanaConfig.username = option_prompt('name: ');
    gitanaConfig.password = option_prompt.hide('password: ');
} // else don't override credentials

// if listing types
if (option_listTypes)
{
    // print a list of definition qnames on the project/branch
    handleListTypes();
} else if (option_nodes) {
    // download and store data from project/branch to a local folder
    handleNodeImport();
} else if (option_definitionQNames && Gitana.isArray(option_definitionQNames))
{
    // download and store data from project/branch to a local folder
    handleImport();
} else {
    printHelp(getOptions());
}

return;

//
// functions
//
function handleNodeImport() {
    log.debug("handleNodeImport()");

    util.getBranch(gitanaConfig, option_branchId, function(err, branch, platform, stack, domain, primaryDomain, project) {
        if (err)
        {
            log.debug("Error connecting to Cloud CMS branch: " + err);
            return;
        }

        log.info("connected to project: \"" + project.title + "\" and branch: " + branch.title || branch._doc);
        
        var context = {
            branchId: option_branchId,
            branch: branch,
            platformId: platform.getId(),
            repositoryId: branch.getRepositoryId(),
            dataFolderPath: option_dataFolderPath,
            includeRelated: option_includeRelated,
            overwriteExistingInstances: option_overwriteExistingInstances,
            relatedRefs: [],            
            nodes: [],
            existingNodes: {},
            relatedNodes: [],
            existingRelatedNodes: [],
            attachmentPaths: {} // array of {"sourceNode": node, "targetNode: node, attachmentsPath"}
        };
        
        async.waterfall([
            async.ensureAsync(async.apply(loadNodesFromDisk, context)),
            async.ensureAsync(loadRelatedNodesFromDisk),
            async.ensureAsync(readExistingNodesFromBranch),
            async.ensureAsync(readExistingRelatedNodesFromBranch),
            async.ensureAsync(readExistingRelatedNodesFromBranchByPath),
            async.ensureAsync(async.apply(writeRelatedNodesToBranch, context.relatedNodes)),
            async.ensureAsync(resolveRelated),
            async.ensureAsync(async.apply(writeNodesToBranch, context.nodes)),
            async.ensureAsync(writeNodeAttachmentsToBranch)
        ], function (err, context) {
            if (err)
            {
                log.error("Error importing: " + err);
                return;
            }

            // log.debug(JSON.stringify(context.typeDefinitions, null, 2));
            
            log.info("Import complete");
            return;
        });                
    });
}

function handleImport() {
    log.debug("handleImport()");

    util.getBranch(gitanaConfig, option_branchId, function(err, branch, platform, stack, domain, primaryDomain, project) {
        if (err)
        {
            log.debug("Error connecting to Cloud CMS branch: " + err);
            return;
        }

        log.info("connected to project: \"" + project.title + "\" and branch: " + branch.title || branch._doc);
        
        var context = {
            branchId: option_branchId,
            branch: branch,
            importTypeQNames: option_definitionQNames,
            typeDefinitions: [],
            dataFolderPath: option_dataFolderPath,
            includeInstances: option_includeInstances,
            overwriteExistingInstances: option_overwriteExistingInstances,
            instanceNodes: [],
            instanceExistingNodes: {},
            instanceQnames: [],
            relatedNodes: [],
            finalDefinitionNodes: []
        };

        async.waterfall([
            async.apply(getDefinitions, context),
            async.ensureAsync(writeDefinitionsToBranch),
            async.ensureAsync(getDefinitionFormAssociations),
            async.ensureAsync(writeFormsToBranch),
            async.ensureAsync(loadContentInstancesFromDisk),
            async.ensureAsync(readExistingContentInstancesFromBranch),
            async.ensureAsync(writeInstanceNodesToBranch),
            async.ensureAsync(writeAttachmentsToBranch)
        ], function (err, context) {
            if (err)
            {
                log.error("Error importing: " + err);
                return;
            }

            log.debug(JSON.stringify(context.typeDefinitions, null, 2));
            
            log.info("Import complete");
            return;
        });                
    });
}

function resolveRelated(context, callback) {
    log.debug("resolveRelated()");

    var nodes = context.nodes;
    
    for(var i = 0; i < nodes.length; i++) {
        log.info("resolving refs for: " + nodes[i]._type + " " + nodes[i].title);
        resolveNodeRefs(context, nodes[i]);
    }


    callback(null, context);
}

function resolveNodeRefs(context, node) {
    log.debug("resolveNodeRefs()");

    var refs = util.findKeyLocations(node, "ref", []);
    var nodes = _.values(context.existingNodes);

    for(var i = 0; i < refs.length; i++) {
        var refId = refs[i].id;
        var refTitle = refs[i].title || "";
        var refQName = refs[i].qname || "";
        var refTypeQName = refs[i].typeQName || "";
        
        if (!refId) {
            log.warn("Invalid ref. Could not resolve ref for node " + node._type + " \"" + node.title + "\" ref: " + refs[i].id + " setting title only");
            continue;
        }

        Object.keys(refs[i]).forEach(function(element) {
            delete refs[i][element];
        });

        // find the new node id
        var newRefNode = context.existingNodes[refQName];  // by qname first
        if (!newRefNode) { // then by type and title
            newRefNode = context.existingNodes[refTypeQName + "_" + refTitle.toLowerCase()];
        }
        // if (!newRefNode && node._filePath) { // finally look for new node by path
        //     newRefNode = context.existingNodes[node._filePath];
        // }

        if (newRefNode) {
            refs[i].id = newRefNode._doc;
            refs[i].ref = "node://" + context.platformId + "/" + context.repositoryId + "/" + context.branch.getId() + "/" + newRefNode._doc;
            refs[i].title = newRefNode.title;
            refs[i].qname = newRefNode._qname;
            refs[i].typeQName = newRefNode._type;
        } else {
            log.error("Could not resolve ref for node " + node._type + " " + node.title + " refId: " + refId + " refTitle: " + refTitle + " refQName: " + refQName + " refTypeQName: " + refTypeQName + " setting title only");
            refs[i].title = refTitle;
        }
    }
}

//
// query for existing nodes by either _filePath, type & title, or _qname
function readExistingNodesFromBranch(context, callback) {
    log.debug("readExistingNodesFromBranch()");

    async.eachSeries(context.nodes, function(node, callback){
        log.debug("query for existing node by _doc: " + node._source_doc);
        
        if (!node) {
            callback();
            return;
        }

        if (node._filePath) {
            context.branch.trap(function(){
                // not found
                log.debug("node not found for path: " + node._filePath);
                callback();
                return;
            }).readNode("root", node._filePath).then(function() {
                log.debug("found node at path: " + node._filePath);
                var thisNode = this;
                util.enhanceNode(thisNode);
                context.existingNodes[node._qname] = thisNode;
                callback();
                return;
            });
        } else if (node.title) {
            context.branch.trap(function(err){
                log.debug("error looking for existing node: " + node.title);
                log.err("err: " + err);
                //     // callback();
            //     // return;
            })
            .queryNodes({
                title: node.title,
                _type: node._type
            }).then(function() {
                if (this.size() === 0) {
                    log.debug("node not found for title: " + node.title);
                    callback();
                    return;
                }
                
                this.keepOne().then(function() {
                    var thisNode = this;
                    log.debug("found node for title: " + thisNode.title);
                    util.enhanceNode(thisNode);
                    context.existingNodes[node._qname] = thisNode;

                    callback();
                    return;
                });                        
            });
        } else {
            context.branch.trap(function(){
                // not found
                log.debug("node not found for _qname: " + node._qname);
                callback();
                return;
            }).queryNodes({
                _qname: node._qname
            }).then(function() {
                var nodes = this.asArray();
                if (nodes.length > 0) {
                    log.debug("found node for _qname: " + node._qname);
                    var thisNode = nodes[0];
                    util.enhanceNode(thisNode);
                    context.existingNodes[node._qname] = thisNode;
                } else {
                    log.debug("did not find node for _qname: " + node._qname);
                }
                callback();
                return;
            });
        }
    }, function() {
        callback(null, context);
        return;
    });        
}

function readExistingRelatedNodesFromBranchByPath(context, callback) {
    log.debug("readExistingRelatedNodesFromBranchByPath()");

    var relatedNodes = context.relatedNodes;
    var existingNodes = context.existingNodes;
    
    var paths = [];
    for(var i = 0; i < relatedNodes.length; i++) { // get a list of all the known paths for related nodes
        var filePath = relatedNodes[i]._filePath || "";
        if (filePath && !existingNodes[filePath]) { // skip if the node at this path is already available from previous query
            paths.push(filePath);            
        }
    }

    async.eachSeries(paths, function(path, callback){
        log.debug("searching for node by path: " + path);
        
        if (!path) {
            callback(null, context);
            return;
        }

        context.branch.trap(function(){
            // not found
            log.info("node not found for path: " + path);
            callback(null, context);
            return;
        }).readNode("root", path, {paths:true}).then(function() {
            log.info("found node at path: " + path);
            var node = this;
            util.enhanceNode(node);
            context.existingNodes[path] = node;
            callback(null, context);
            return;
        });

    }, function() {
        callback(null, context);
        return;
    });        
}

function readExistingNodesFromBranchByQName(context, callback) {
    log.debug("readExistingNodesFromBranchByQName()");

    var qnames = _.map(context.nodes, function(node) {
        return node._qname;
    });

    var query = {
        _qname: { 
            "$in": qnames
        }
    };

    context.branch.queryNodes(query,{
        limit: -1
    }
    ).each(function() {
        var node = this;
        util.enhanceNode(node);
        context.existingNodes[node._qname] = node;
    }
    ).then(function() {
        // var nodes = this.asArray();
        // context.existingNodes = nodes;
        callback(null, context);
    });
}

function readExistingRelatedNodesFromBranch(context, callback) {
    log.debug("readExistingRelatedNodesFromBranch()");

    if (!context.includeRelated) {
        callback(null, context);
        return;
    }

    context.relatedRefs = util.findKeyLocations(context.nodes, "ref", []);
    var relatedQuery = _.map(context.relatedRefs, function(ref) {
        var q;
        if (ref.title) {
            q = {
                "$or": [
                    {
                        _type: ref.typeQName,
                        // title: ref.title
                        title: { 
                            "$regex": "^" + ref.title.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + "$",
                            "$options": "i"
                        }                    
                    },
                    {
                        _qname: ref.qname
                    }
                ]
            };
        } else {
            q = {
                "$or": [
                    {
                        _type: ref.typeQName,
                    },
                    {
                        _qname: ref.qname
                    }
                ]
            };
        }

        return q;
    });

    if (!relatedQuery || !relatedQuery.length) {
        callback(null, context);
        return;
    }

    var query = {
        "$or": relatedQuery
    };

    context.branch.queryNodes(query,{
        limit: -1,
        paths: true
    // }).each(function() {
    //     var node = this;
    //     util.enhanceNode(node);
    //     context.existingNodes[node._qname] = node;
    }).then(function() {
        var nodes = this.asArray();
        nodes = _.map(nodes, function(node) {
            util.enhanceNode(node);
            context.existingNodes[node._qname] = node;
            context.existingNodes[node._type + "_" + (node.title || "").toLowerCase()] = node;
            if (node._filePath) {
                context.existingNodes[node._filePath] = node;
            }
            return node;
        });

        // context.existingRelatedNodes.concat(nodes);
            
        callback(null, context);
    });
}

function readExistingContentInstancesFromBranch(context, callback) {
    log.debug("readExistingContentInstancesFromBranch()");

    var query = {
        _qname: { 
            "$in": context.instanceQnames
        }
    };

    context.branch.queryNodes(query,{
        limit: -1
    }).each(function() {
        var instance = this;
        util.enhanceNode(instance);
        context.instanceExistingNodes[instance._qname] = instance;
    }).then(function() {
        var instanceNodes = this.asArray();
        log.debug("instances: " + JSON.stringify(instanceNodes, null, 2));
        callback(null, context);
    });

}

//
// for each type qname being imported:
//  - load instances from local disk
//  - query for _qname to determine if the record already exists
//  - either .update() or .createNode()
function loadContentInstancesFromDisk(context, callback) {
    log.debug("loadContentInstancesFromDisk()");

    if (!context.includeInstances) {
        return callback(null, context);
    }

    var typeDefinitions = context.importTypeQNames;
    
    // find and load json
    for(var i = 0; i < typeDefinitions.length; i++) {
        var instancesPath = path.normalize(pathResolve(context.dataFolderPath, "instances", typeDefinitions[i].replace(':', '__SC__')));
        var files = util.findFiles(instancesPath, "node.json");
        if (files && Gitana.isArray(files)) {
            for(var j = 0; j < files.length; j++) {
                var jsonNode = loadJsonFile.sync(files[j]);            
                context.instanceNodes.push(jsonNode);
                context.instanceQnames.push(jsonNode._qname);
            }            
        }        
    }

    return callback(null, context);
}

function loadNodesFromDisk(context, callback) {
    log.debug("loadNodesFromDisk()");

    // find and load json
    var nodesPath = path.normalize(pathResolve(context.dataFolderPath, "nodes"));
    var files = util.findFiles(nodesPath, "node.json");

    if (files && Gitana.isArray(files)) {
        for(var i = 0; i < files.length; i++) {
            var jsonNode = loadJsonFile.sync(files[i]);            
            context.nodes.push(jsonNode);

            var attachmentsPath = path.normalize(pathResolve(files[i], "..", "attachments"));
            
            if (attachmentsPath && fs.existsSync(attachmentsPath)) {
                var theseFiles = fs.readdirSync(attachmentsPath);
                for(var j = 0; j < theseFiles.length; j++) {
                    context.attachmentPaths[jsonNode._qname] = {
                        source: jsonNode,
                        target: null,
                        path: path.normalize(pathResolve(attachmentsPath, theseFiles[j]))
                    };    
                }
            }            
        }            
    }        

    return callback(null, context);
}

function loadRelatedNodesFromDisk(context, callback) {
    log.debug("loadRelatedNodesFromDisk()");

    if (!context.includeRelated) {
        callback(null, context);
        return;
    }

    // find and load json
    var nodesPath = path.normalize(pathResolve(context.dataFolderPath, "related"));
    var files = util.findFiles(nodesPath, "node.json");

    if (files && Gitana.isArray(files)) {
        for(var i = 0; i < files.length; i++) {
            var jsonNode = loadJsonFile.sync(files[i]);            
            context.relatedNodes.push(jsonNode);

            var attachmentsPath = path.normalize(pathResolve(files[i], "..", "attachments"));
            
            if (attachmentsPath && fs.existsSync(attachmentsPath)) {
                var theseFiles = fs.readdirSync(attachmentsPath);
                for(var j = 0; j < theseFiles.length; j++) {
                    context.attachmentPaths[jsonNode._qname] = {
                        source: jsonNode,
                        target: null,
                        path: path.normalize(pathResolve(attachmentsPath, theseFiles[j]))
                    };    
                }
            }            
        }            
    }        

    return callback(null, context);
}

function writeNodeAttachmentsToBranch(context, callback) {
    log.debug("writeNodeAttachmentsToBranch()");

    var nodes = context.nodes || [];
    if (!nodes) {
        callback(null, context);
        return;
    }

    async.eachSeries(context.attachmentPaths, function(attachmentPath, callback){
        log.info("adding attachment " + attachmentPath.path);

        var attachmentId = path.basename(attachmentPath.path, path.extname(attachmentPath.path));
        attachmentId = attachmentId.replace('.', '_');
        var mimetype = mime.lookup(attachmentPath.path);

        attachmentPath.target.attach(
            attachmentId,
            mimetype,
            fs.readFileSync(attachmentPath.path))
        .trap(function(err){
            log.error("Attachment upload failed " + attachmentPath.path + " " + err);
        }).then(function(){
            log.info("Attachment upload complete");
            callback();
        });
    }, function(err){
        if (err) {
            log.error("Error uploading attachments: " + err);
        }
        return callback(err, context);
    });
}

function writeAttachmentsToBranch(context, callback) {
    log.debug("writeAttachmentsToBranch()");

    var nodes = context.instanceNodes.concat(context.relatedNodes);

    async.each(nodes, function(node, callback){
        async.each(Object.keys(node.attachments || {}), function(attachment, callback){
            log.debug("adding attachment " + attachment.attachmentId + " to " + node._doc || node._source_doc);

            node.attach(
                attachment.attachmentId,
                mime.lookup(attachment.path),
                fs.readFileSync(attachment.path),
                path.basename(attachment.path))
            .trap(function(err){
                return callback("Attachment upload failed " + err);
            }).then(function(){
                console.log("Attachment upload complete");
                callback();
            });
        }, function(err){
            return callback(err, context);
        });
    });
}

// function writeRelatedNodesToBranch(context, callback) {
//     log.debug("writeRelatedNodesToBranch()");

//     if (!context.includeRelated) {
//         log.info("Skipping related nodes");
//         callback(null, context);
//         return;
//     }
        
//     async.eachSeries(nodes, async.apply(writeNodeToBranch, context), function (err) {
//         if(err)
//         {
//             log.error("Error: " + err);
//             callback(err);
//             return;
//         }
        
//         log.debug("loaded nodes");
//         callback(null, context);
//         return;
//     });        
// }

function writeRelatedNodesToBranch(nodes, context, callback) {
    log.debug("writeRelatedNodesToBranch()");

    if (!context.includeRelated) {
        log.info("Skipping related nodes");
        callback(null, context);
        return;
    }

    writeNodesToBranch(nodes, context, callback);
}

function writeNodesToBranch(nodes, context, callback) {
    log.debug("writeNodesToBranch()");
    
    async.eachSeries(nodes, async.apply(writeNodeToBranch, context), function (err) {
        if(err)
        {
            log.error("Error: " + err);
            callback(err);
            return;
        }
        
        log.debug("loaded nodes");
        callback(null, context);
        return;
    });        
}

function writeNodeToBranch(context, node, callback) {
    log.debug("writeNodeToBranch()");

    var existingNode = context.existingNodes[node._qname]; // look for existing node by qname first
    if (!existingNode && node._filePath) { // by path next
        existingNode = context.existingNodes[node._filePath];
     }
     if (!existingNode) { // finally by type and title
        existingNode = context.existingNodes[node._type + "_" + node.title.toLowerCase() || ""];
     }

     if (existingNode) {
        // update unless instructed not to
        // if (!context.overwriteExistingInstances) {
        //     log.info("Found instance node but overwrite mode is off so not updating: " + existingNode._doc);
        //     callback(null, context);
        //     return;
        // }

        // _.extend(node, existingNode);
        util.updateDocumentProperties(existingNode, node);
        
        if (!existingNode._source_doc) {
            existingNode._source_doc = node._source_doc || "";
        }    
        Chain(existingNode).update()
        // .trap(function(err){
        //     callback("writeNodeToBranch() " + err, context);
        //     return;
        // })
        .reload().then(function(){
            var thisNode = this;
            util.enhanceNode(thisNode);
            if (!thisNode._source_doc) {
                thisNode._source_doc = node._source_doc || "";
            }
            log.info("Updated node " + thisNode._doc + " " + thisNode._type + " " + thisNode.title || "");
            if (context.attachmentPaths[node._qname]) {
                context.attachmentPaths[node._qname].target = thisNode;
            }
            callback(null, context);
            return;
        });        
    }
    else
    {
        // create
        context.branch.trap(function(err){
            if (err) {
                log.error("createNode() error: " + err, context);
            }
            return callback("createNode() " + err, context);
        }).createNode(node).then(function(){ 
            thisNode = this;
            log.info("Created node " + thisNode._doc);
            util.enhanceNode(thisNode);
            if (!thisNode._source_doc) {
                thisNode._source_doc = node._source_doc || "";
            }
            if (context.attachmentPaths[node._qname]) {
                context.attachmentPaths[node._qname].target = thisNode;
            }
            callback(null, context);
            return;
        });        
    }
}

function writeInstanceNodesToBranch(context, callback) {
    log.debug("writeInstanceNodesToBranch()");
    
    async.eachSeries(context.instanceNodes, async.apply(writeInstanceNodeToBranch, context), function (err) {
        if(err)
        {
            log.error("Error: " + err);
            callback(err);
            return;
        }
        
        log.debug("loaded");
        callback(null, context);
        return;
    });        
}

function writeInstanceNodeToBranch(context, instanceNode, callback) {
    log.debug("writeInstanceNodeToBranch()");

    var existingNode = context.instanceExistingNodes[instanceNode._qname];
    if (existingNode) {
        // update unless instructed not to
        if (!context.overwriteExistingInstances) {
            log.info("Found instance node but overwrite mode is off so not updating: " + existingNode._doc);
            callback(null, context);
            return;
        }
        
        util.updateDocumentProperties(existingNode, instanceNode);
        existingNode.update().trap(function(err){
            callback("writeDefinition() " + err, context);
            return;
        }).then(function(){
            var node = this;
            util.enhanceNode(node);
            log.info("Updated instance node " + node._doc + " " + node._type + " " + node.title || "");
            callback(null, context);
            return;
        });        
    }
    else
    {
        // create
        context.branch.createNode(instanceNode).trap(function(err){
            if (err) {
                return callback("createNode() " + err, context);
            }
        }).then(function(){ 
            node = this;            
            log.info("Created instance node " + node._doc);
            callback(null, context);
            return;
        });        
    }
}

function writeFormsToBranch(context, callback) {
    log.debug("writeFormsToBranch()");

    var finalDefinitionNodes = context.finalDefinitionNodes;
    
    async.eachSeries(finalDefinitionNodes, async.apply(writeFormToBranch, context), function (err) {
        if(err)
        {
            log.error("Error loading forms: " + err);
            callback(err);
            return;
        }
        
        log.debug("loaded forms");
        callback(null, context);
        return;
    });        
}

function writeFormToBranch(context, definitionNode, callback) {
    if (definitionNode._type !== "d:type") {
        callback(null, context);
        return;
    }

    var formsPath = path.normalize(pathResolve(context.dataFolderPath, "definitions", definitionNode._qname.replace(':', '__SC__'), "forms"));
    var formKeys = [];
    try {
        formKeys = fs.readdirSync(formsPath);
    } 
    catch(e) 
    {
        log.info("no forms found for " + definitionNode._qname);
        formKeys = [];
    }

    var newFormNodes = [];

    for(var i = 0; i < formKeys.length; i++) {
        var newFormNode = loadFormNodeFromDisk(context, definitionNode._qname.replace(':', '__SC__'), formKeys[i]);
        newFormNode.__formKey = formKeys[i].replace('__SC__', ':').replace(/\.json$/, '');
        newFormNodes.push(newFormNode);
    }

    if (!newFormNodes.length) {
        callback(null, context);
        return;
    }

    async.eachSeries(newFormNodes, async.apply(writeFormNodeToBranch, context, definitionNode), function (err) {
        if(err)
        {
            log.error("Error loading forms: " + err);
            callback(err);
            return;
        }
        
        log.debug("loaded forms");
        callback(null, context);
        return;
    });        
}

function writeFormNodeToBranch(context, definitionNode, formNode, callback) {
    var thisFormKey = formNode.__formKey;
    var existingFormNodeId = null;
    for(var i = 0; i < definitionNode.__formAssociations.length; i++) {
        if (definitionNode.__formAssociations[i]["form-key"] == thisFormKey) {
            existingFormNodeId = definitionNode.__formAssociations[i].target;
            break;
        }
    }

    if (existingFormNodeId) {
        context.branch.queryNodes({_qname: formNode._qname}).trap(function(err){
            if (err) {
                return callback("writeFormNodeToBranch() could not load existing form node: " + thisFormKey + " _qname:" + formNode._qname + " " + err, context);
            }
        }).then(function() {
            if (this.size() === 0) {
                callback(null, context);
                return;
            }

            this.keepOne().then(function() {
                var thisNode = this;      
                log.debug("writeFormNodeToBranch update existing form node: " + existingFormNodeId);

                util.updateDocumentProperties(thisNode, formNode);
                thisNode.update().trap(function(err){
                    callback("writeDefinition() " + err, context);
                    return;
                }).then(function(){      
                    var newNode = this;      
                    log.info("Updated form node " + newNode._doc + " " + thisFormKey);
                    callback(null, context);
                    return;
                });        
            });
        });
    }
    else
    {
        // create the form node and association
        context.branch.createNode(formNode).trap(function(err){
            if (err) {
                return callback("writeDefinition() could not create form node for form key: " + thisFormKey + " " + err, context);
            }
        }).then(function(){ 
            thisNode = this;            
            log.info("Created form node " + thisNode._doc);

            context.branch.associate(definitionNode, thisNode, {"_type": "a:has_form", "form-key": thisFormKey}).then(function(){      
                var thisAssociationNode = this;      
                log.info("Associated definition node to form node: " + thisAssociationNode._doc + " using form key: " + thisFormKey);
                callback(null, context);
                return;
            });  

        });        
    }    
}

function writeDefinitionsToBranch(context, callback) {
    log.debug("writeDefinitionsToBranch()");

    var typeDefinitions = context.importTypeQNames;
    
    async.eachSeries(typeDefinitions, async.apply(writeDefinitionToBranch, context), function (err) {
        if(err)
        {
            log.error("Error: " + err);
            callback(err);
            return;
        }
        
        log.debug("loaded");
        callback(null, context);
        return;
    });        
}

function writeDefinitionToBranch(context, definitionQname, callback) {
    var definitionNode = null;
    for(var i = 0; i < context.typeDefinitions.length; i++) {
        if (context.typeDefinitions[i]._qname == definitionQname) {
            // definiion exists in branch so updated it
            definitionNode = context.typeDefinitions[i];
            break;
        }
    }

    var newDefinitionNode = loadDefinitionNodeFromDisk(context, definitionQname);
    if (definitionNode) {
        // update
        util.updateDocumentProperties(definitionNode, newDefinitionNode);
        
        definitionNode.update().trap(function(err){
            callback("writeDefinition() " + err, context);
            return;
        }).then(function(){      
            var newNode = this;
            util.enhanceNode(newNode);         
            context.finalDefinitionNodes.push(newNode);
            log.info("Updated definition node " + newNode._doc + " " + newNode._qname + " " + newNode.title);
            callback(null, context);
            return;
        });        
    }
    else
    {
        // create
        context.branch.createNode(newDefinitionNode).trap(function(err){
            if (err) {
                return callback("createNode() " + err, context);
            }
        }).then(function(){ 
            definitionNode = this;   
            util.enhanceNode(definitionNode);         
            context.finalDefinitionNodes.push(definitionNode);
            log.info("Created definition node " + definitionNode._doc);
            callback(null, context);
            return;
        });        
    }
}

function loadDefinitionNodeFromDisk(context, definitionQname) {
    var jsonNode = loadJsonFile.sync(buildDefinitionPath(context.dataFolderPath, {_qname: definitionQname}));
    return jsonNode;
}

function loadFormNodeFromDisk(context, definitionQname, formKey) {
    var jsonNode = loadJsonFile.sync(buildFormPath(context.dataFolderPath, {_qname: definitionQname}, formKey));
    return jsonNode;
}

function writeContentInstanceJSONtoDisk(context, callback) {
    log.debug("writeContentInstanceJSONtoDisk()");

    var instanceNodes = context.instanceNodes;
    var dataFolderPath = path.posix.normalize(context.dataFolderPath);
    
    Object.keys(instanceNodes).forEach(function(type) {
        for(var i = 0; i < instanceNodes[type].length; i++) {
            // var node = cleanNode(instanceNodes[type][i], "x");
            var node = cleanNode(instanceNodes[type][i]);
            writeJsonFile.sync(buildInstancePath(dataFolderPath, node), node);
        }
    });

    callback(null, context);
}

function buildInstancePath(dataFolderPath, node) {
    return path.normalize(pathResolve(dataFolderPath, "instances", node._type.replace(':', '__SC__'), node._source_doc, "node.json"));
}

function getContentInstances(context, callback) {
    log.debug("getContentInstances()");

    if (!context.includeInstances) {
        callback(null, context);
        return;
    }

    var typeDefinitions = context.typeDefinitions;

    if (!typeDefinitions || !Gitana.isArray(typeDefinitions) || !typeDefinitions.length) {
        callback("No type defintions");
        return;
    }

    async.eachSeries(typeDefinitions, async.apply(getDefinitionInstances, context), function (err) {
        if(err)
        {
            log.error("Error reading content instances: " + err);
            callback(err);
            return;
        }
        
        log.debug("loaded definition instances");
        callback(null, context);
        return;
    });        
}

function getDefinitionInstances(context, typeDefinitionNode, callback) {
    log.debug("getDefinitionInstances()");

    var query = {
        _type: typeDefinitionNode._qname
    }

    if (!context.instanceNodes[typeDefinitionNode._qname]) {
        context.instanceNodes[typeDefinitionNode._qname] = [];
    }

    context.branch.queryNodes(query,{
        limit: -1
    }).each(function() {
        var instance = this;
        util.enhanceNode(instance);
        context.instanceNodes[typeDefinitionNode._qname].push(instance);
    }).then(function() {
        log.debug("instances: " + JSON.stringify(context.instanceNodes, null, 2));
        callback(null, context);
    });
}

function handleListTypes() {
    log.debug("handleListTypes()");
    
    util.getBranch(gitanaConfig, option_branchId, function(err, branch, platform, stack, domain, primaryDomain) {
        if (err)
        {
            log.debug("Error connecting to Cloud CMS branch: " + err);
            return;
        }

        log.info("connected to branch: " + branch.title || branch._doc);

        var context = {
            branchId: option_branchId,
            branch: branch,
            typeDefinitions: []
        };
        
        getDefinitions(context, function(err, context) {
            if (err)
            {
                log.error("Error listing definition nodes " + err);
                return;
            }

            Object.keys(context.typeDefinitions).forEach(function(type) {
                log.debug(JSON.stringify(context.typeDefinitions[type]));
                console.log("type: " + context.typeDefinitions[type]._type + "\t_qname: " + context.typeDefinitions[type]._qname + "\tTitle: \"" + context.typeDefinitions[type].title + "\"");
            });

            console.log("\ndone");            
        });
    });
}

function writeDefinitionJSONtoDisk(context, callback) {
    var dataFolderPath = context.dataFolderPath;
    var includeInstances = context.includeInstances;
    var typeDefinitions = context.typeDefinitions;

    dataFolderPath = path.posix.normalize(dataFolderPath)
    if (fs.existsSync(dataFolderPath)) {
        Object.keys(typeDefinitions).forEach(function(typeId) {
            log.debug(JSON.stringify(typeDefinitions[typeId]));
            writeFormJsontoDisk(dataFolderPath, typeDefinitions[typeId]);
            var node = cleanNode(typeDefinitions[typeId]);
            writeJsonFile.sync(buildDefinitionPath(dataFolderPath, node), node);
        });

        console.log('done');
        callback(null, context);
        return;
    }
    else
    {
        callback("folder path not found: " + dataFolderPath);
        return;
    }
}

function buildDefinitionPath(dataFolderPath, node) {
    return path.normalize(pathResolve(dataFolderPath, "definitions", node._qname.replace(':', '__SC__'), "node.json"));
}

function buildFormPath(dataFolderPath, node, formKey) {
    return path.normalize(pathResolve(dataFolderPath, "definitions", node._qname.replace(':', '__SC__'), "forms", formKey));
}

function cleanNode(node, qnameMod) {
    var n = node;
    util.enhanceNode(n);
    
    n._source_doc = n._doc;
    n._qname += qnameMod || "";
    delete n._doc;
    delete n._system;
    delete n.attachments;
    delete n.__forms;
    delete n.__formAssociations;
    
    return n;
}

function logContext(context, callback) {
    log.debug("logContext() " + JSON.stringify(context.branch, null, 2));
    callback(null, context);
}

function getDefinitions(context, callback) {
    log.debug("getTypeDefinitionsByQname()");

    var qnames = context.importTypeQNames;

    if (!context.typeDefinitions) {
        context.typeDefinitions = [];
    }

    var query = {
        _type: {
            "$in": ["d:type", "d:association", "d:feature"]
        },
        _qname: { 
            "$in": qnames
        }
    }

    if (qnames && Gitana.isArray(qnames)) {
        query._qname = {
            "$in": qnames
        };
    }

    context.branch.queryNodes(query,{
        limit: -1,
        sort: {
            _type: 1,
            title: 1
        }
    }).each(function() {
        var definition = this;
        util.enhanceNode(definition);
        context.typeDefinitions.push(definition);
    }).then(function() {
        log.debug("definitions: " + JSON.stringify(context.typeDefinitions, null, 2));
        callback(null, context);
    });
}

function readDefinition(context, callback) {
    log.debug("readDefinition()");

    context.branch.readDefinition().each(function() {
        var definition = this;
        util.enhanceNode(definition);
        context.typeDefinitions.push(definition);
    }).then(function() {
        log.debug("definitions: " + JSON.stringify(context.typeDefinitions, null, 2));
        callback(null, context);
    });
}

function getDefinitionForms(context, callback) {
    log.debug("getDefinitionForms()");

    var typeDefinitions = context.typeDefinitions;

    if (!typeDefinitions || !Gitana.isArray(typeDefinitions) || !typeDefinitions.length) {
        callback("No type defintions");
        return;
    }

    async.eachSeries(typeDefinitions, getDefinitionFormList, function (err) {
        if(err)
        {
            log.error("Error reading definition forms: " + err);
            callback(err);
            return;
        }
        
        log.debug("loaded definition forms");
        callback(null, context);
        return;
    });        
}

function getDefinitionFormAssociations(context, callback) {
    log.debug("getDefinitionFormAssociations()");

    var typeDefinitions = context.finalDefinitionNodes;

    if (!typeDefinitions || !Gitana.isArray(typeDefinitions) || !typeDefinitions.length) {
        callback("No type defintions");
        return;
    }

    async.eachSeries(typeDefinitions, getDefinitionFormAssociationList, function (err) {
        if(err)
        {
            log.error("Error reading definition form associations: " + err);
            callback(err);
            return;
        }
        
        log.debug("loaded definition form associations");
        callback(null, context);
        return;
    });        
}

function getDefinitionFormList(typeDefinitionNode, callback) {
    log.debug("getDefinitionFormList()");

    typeDefinitionNode.listRelatives({
        "type": "a:has_form",
        "direction": "OUTGOING"
    }).then(function() {
        log.debug("relatives: " + JSON.stringify(this, null, 2));
        typeDefinitionNode.__forms = this.asArray();
        callback();
    });
}

function getDefinitionFormAssociationList(typeDefinitionNode, callback) {
    log.debug("getDefinitionFormList()");

    typeDefinitionNode.associations({
        "type": "a:has_form",
        "direction": "OUTGOING"
    }).then(function() {
        log.debug("associations: " + JSON.stringify(this, null, 2));
        typeDefinitionNode.__formAssociations = this.asArray();
        callback();
    });
}

function getOptions() {
    return [
        {name: 'help', alias: 'h', type: Boolean},
        {name: 'verbose', alias: 'v', type: Boolean, description: 'verbose logging'},
        {name: 'prompt', alias: 'p', type: Boolean, description: 'prompt for username and password. overrides gitana.json credentials'},
        {name: 'use-credentials-file', alias: 'c', type: Boolean, description: 'use credentials file ~/.cloudcms/credentials.json. overrides gitana.json credentials'},
        {name: 'gitana-file-path', alias: 'g', type: String, description: 'path to gitana.json file to use when connecting. defaults to ./gitana.json'},
        {name: 'branch', alias: 'b', type: String, description: 'branch id (not branch name!) to write content to. branch id or "master". Default is "master"'},
        {name: 'list-types', alias: 'l', type: Boolean, description: 'list type definitions available in the branch'},
        {name: 'definition-qname', alias: 'q', type: String, multiple: true, description: '_qname of the type definition'},
        {name: 'include-instances', alias: 'i', type: Boolean, description: 'include instance records for content type definitions'},
        {name: 'nodes', alias: 'n', type: Boolean, description: 'instead of importing definitions, import nodes in the nodes folder (and, optionally, their related nodes)'},        
        {name: 'include-related', alias: 'r', type: Boolean, description: 'include instance records referred to in relators on instance records'},        
        {name: 'overwrite-instances', alias: 'o', type: Boolean, description: 'overwrite instance records. by default only missing records will be created. this will cause existing records to be updated as well'},
        {name: 'folder-path', alias: 'f', type: String, description: 'folder to store exported files. defaults to ./data'}
    ];
}

function handleOptions() {

    var options = cliArgs(getOptions());

    if (options.help)
    {
        printHelp(getOptions());
        return null;
    }

    return options;
}

function printHelp(optionsList) {
    console.log(commandLineUsage([
        {
            header: 'Cloud CMS Import',
            content: 'Import defintions and content instance records to a Cloud CMS project branch.'
        },
        {
            header: 'Options',
            optionList: optionsList
        },
        {
            header: 'Examples',
            content: [
                {
                    desc: '1. connect to Cloud CMS and list available definition qnames',
                },
                {
                    desc: 'node mm-import.js --list-types'
                },
                {
                    desc: '2. import definitions and content records by qname:',
                },
                {
                    desc: 'node mm-import.js --definition-qname "mmcx:type1" "mmcx:type2" --include-instances --folder-path ./data'
                },
                {
                    desc: '3. import nodes and their related records:',
                },
                {
                    desc: 'node mm-import.js --nodes --include-related --folder-path ./data'
                }
            ]
        }
    ]));
}