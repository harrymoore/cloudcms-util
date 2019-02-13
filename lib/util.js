var Gitana = require("gitana");
var wrench = require("wrench");
var path = require("path");
var fs = require("fs");
var async = require("async");
var http = require("http");
var https = require("https");
var url = require('url');
var request = require("request");
var legacy = require("./legacy")
var _ = require("underscore")
var chalk = require('chalk');

module.exports = function() {

    var r = {};

    var homeDirectory = r.homeDirectory = function()
    {
        return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
    };

    var slugifyText = r.slugifyText = function(value)
    {
        var _regexWhitespace = new RegExp("\\\s+", "g");

        value = value.replace(_regexWhitespace, '-');
        value = value.toLowerCase();
        return value;
    };

    var updateDocumentProperties = r.updateDocumentProperties = function(node, json)
    {
        var badKeys = [];
        var x = JSON.parse(JSON.stringify(node));
        for (var k in x)
        {
            badKeys.push(k);
        }
        for (var i = 0; i < badKeys.length; i++)
        {
            if ((badKeys[i] === "_doc") || (badKeys[i] === "_qname")) {
                continue;
            }
            delete node[badKeys[i]];
        }

        for (var k in json)
        {
            node[k] = json[k];
        }
    }

    var findKeyValues = r.findKeyValues = function(rootObj, targetKey, arr = []) {
        if(rootObj && rootObj._qname) console.log(rootObj._qname);
        
        Object.keys(rootObj || {}).forEach(k => {
          if (k === targetKey) {
            arr.push(rootObj[k]);
          }
          if (typeof rootObj[k] === 'object') {
            findKeyValues(rootObj[k], targetKey, arr);
          }
        });
        return arr;
    };

    var findKeyLocations = r.findKeyLocations = function(rootObj, targetKey, arr = []) {
        Object.keys(rootObj || {}).forEach(k => {
          if (k === targetKey) {
            arr.push(rootObj);
          }
          if (typeof rootObj[k] === 'object') {
            findKeyLocations(rootObj[k], targetKey, arr);
          }
        });
        return arr;
    };

    var refFromNode = r.refFromNode = function(node)
    {
        return {
            "id": node._doc,
            "ref": "node://" + [
                node.getBranch().getPlatformId(),
                node.getBranch().getRepositoryId(),
                node.getBranch().getId(),
                node._doc,
            ].join('/')
            // "title": node.title,
            // "qname": node._qname,
            // "typeQName": node._type
        }
    };

    /**
     * connect to Cloud CMS and retrieve branch
     * 
     */
    var getBranch = r.getBranch = function(gitanaConfig, branchId, callback)
    {
        Gitana.connect(gitanaConfig, function(err) {
            if (err) {
                // console.log("Failed to connect: " + JSON.stringify(err));
                return callback(chalk.red("Failed to connect: " + JSON.stringify(err)));
            }

            var appHelper = this;
            var platform = appHelper.platform();
            var primaryDomain = platform.readPrimaryDomain();
            var stack = appHelper.stack();
            var project = appHelper.project();
            
            appHelper.datastore("content").trap(function(err) {
                console.log(chalk.red("Failed to retrieve datastore: " + JSON.stringify(err)));
                return callback(err);

            }).readBranch(branchId || "master").then(function () {
                var branch = this;
                domain = appHelper.datastore("principals");
                // console.log("connected to project: \"" + project.title + "\" and branch: \"" + branch.title || branch._doc + "\"");
                return callback(null, branch, platform, stack, domain, primaryDomain, project);
            });
        });
    };
    
    var queryNodes = r.queryNodes = function(branch, query, paging, callback) {
        var node = null;
        Chain(branch).trap(function(err) {
            return callback(err);
        }).queryNodes(query, paging).then(function() {
            return callback(null, this);
        });
    }
    
    var findOrCreateNode = r.findOrCreateNode = function(branch, query, json, callback) {
        var node = null;
        Chain(branch).trap(function(err) {
            return callback(err);
        }).queryNodes(query).keepOne().then(function() {
            node = this;

            if(!node || !node._doc)
            {
                Chain(branch).createNode(json).trap(function(err){
                    return callback(err);
                }).then(function(){
                    node = this;
                    
                    if(!node || !node._doc)
                    {
                        return callback("Node not created");
                    }

                    // console.log("Created node " + JSON.stringify(this));
                    console.log(chalk.green("Created node " + node._doc));
                    return callback(null, node);
                });
            }
            else
            {
                return callback(null, node);
            }
        });
    }

    var deleteNodes = r.deleteNodes = function(branch, deleteQuery, callback)
    {
        console.log("Deleting nodes " + JSON.stringify(deleteQuery));

        branch.subchain(branch).then(function() {
            var nodes = [];
            branch.queryNodes(deleteQuery, {"limit": 500}).each(function(){
                nodes.push(this._doc);
            }).then(function() {
                if (nodes.length === 0)
                {
                    return callback();
                }

                branch.subchain(branch).deleteNodes(nodes).then(function(){
                    callback();
                });
            });       
        });
    };

    var createNodes = r.createNodes = function(branch, nodes, callback)
    {
        // console.log("Creating node " + JSON.stringify(nodes[0]));

        Chain(branch).trap(function(err) {
            return callback(err);
        }).then(function() {
            for(var i = 0; i < nodes.length; i++)
            {
                branch.createNode(nodes[i]).then(function(){
                    nodes[i] = this;
                });
            }
            
            branch.then(function(){
                return callback(null, nodes);
            });
        });
    };
    
    /**
     * Reads a JSON file from disk.
     *
     * @type {Function}
     */
    var readJsonObject = r.readJsonObject = function(filePath)
    {
        var text = fs.readFileSync(filePath, "utf8");

        return JSON.parse("" + text);
    };

    /**
     * Finds files within a given directory that have a given name.
     *
     * @param dirPath
     * @param name
     * @returns {Array}
     */
    var findFiles = r.findFiles = function(dirPath, name)
    {
        var paths = [];

        try {
            var allFiles = wrench.readdirSyncRecursive(dirPath);
            for (var i = 0; i < allFiles.length; i++)
            {
                var filename = path.basename(allFiles[i]);
                if (filename === name)
                {
                    var fullPath = path.join(dirPath, allFiles[i]);

                    paths.push(fullPath);
                }
            }

            return paths;
        } catch (error) {
            console.log(chalk.red("No local types defined. Folder not found: " + dirPath + ". error: " + error));
            return null;
        }
    };

    /**
     * Finds folder within a given directory that have a given name.
     *
     * @param dirPath
     * @param name
     * @returns {Array}
     */
    var findFolders = r.findFolders = function(dirPath, folderName)
    {
        var paths = [];

        try {
            var allFiles = wrench.readdirSyncRecursive(dirPath);
            for (var i = 0; i < allFiles.length; i++)
            {
                var name = path.basename(allFiles[i]);
                if (folderName === name)
                {
                    var fullPath = path.join(dirPath, allFiles[i]);

                    paths.push(fullPath);
                }
            }

            return paths;
        } catch (error) {
            console.log(chalk.red("No local types defined. Folder not found: " + dirPath + ". error: " + error));
            return null;
        }
    };

    /**
     * Finds files within a given directory whos name matches extension.
     *
     * @param dirPath
     * @param  
     * @returns {Array}
     */
    var findFilesExt = r.findFilesExt = function(dirPath, ext)
    {
        var paths = [];

        try {
            var allFiles = wrench.readdirSyncRecursive(dirPath);
            for (var i = 0; i < allFiles.length; i++)
            {
                var filename = path.basename(allFiles[i]);
                if (filename.toLowerCase().endsWith(ext.toLowerCase()))
                {
                    var fullPath = path.join(dirPath, allFiles[i]);

                    paths.push(fullPath);
                }
            }

            return paths;
        } catch (error) {
            console.log(chalk.red("No local types defined. Folder not found: " + dirPath + ". error: " + error));
            return null;
        }
    };

    /**
     * Strips a key from a JSON object and hands back the value.
     *
     * @type {Function}
     */
    var strip = r.strip = function(json, key)
    {
        var x = json[key];
        delete json[key];

        return x;
    };

    var loadCsvFromGoogleDocs = r.loadCsvFromGoogleDocs = function(key, callback)
    {
        // var url = "https://docs.google.com/spreadsheets/d/" + key + "/export?format=csv&id=" + key + "&gid=0";
        var url = "https://docs.google.com/a/cloudcms.com/spreadsheets/d/" + key + "/export?format=csv&id=" + key;
        console.log("  -> " + url);
        request(url, function (error, response, body) {

            if (error) {
                console.log("ERROR WHILE REQUESTING GOOGLE DOC: " + url);
                process.exit();
                return callback(error);
            }

            if (response.statusCode === 404) {
                console.log("Heard 404: " + url);
                process.exit();
                return callback();
            }

            if (response.statusCode == 200) {
                return callback(null, "" + body);
            }

            console.log("HEARD: " + response.statusCode + " for URL: " + url);
            process.exit();

            callback({
                "code": response.statusCode
            });
        });
    };

    var buildObjectFromCsv = r.buildObjectFromCsv = function(csvText, keyColumnIndex, valueColumnIndex, callback)
    {
        csv.parse(csvText, function(err, data) {

            var obj = {};

            if (data.length > 0)
            {
                for (var i = 1; i < data.length; i++)
                {
                    var key = data[i][keyColumnIndex];
                    var value = data[i][valueColumnIndex];

                    obj[key] = value;
                }
            }

            callback(null, obj);
        });
    };

    var buildObjectFromCsvData = r.buildObjectFromCsvData = function(csvData, keyColumnIndex, valueColumnIndex)
    {
        var obj = {};

        if (csvData && csvData.length > 0)
        {
            for (var i = 1; i < csvData.length; i++)
            {
                var key = csvData[i][keyColumnIndex];
                var value = csvData[i][valueColumnIndex];

                obj[key] = value;
            }
        }

        return obj;
    };

    var loadCsvFile = r.loadCsvFile = function(csvPath, callback)
    {
        var csvText = fs.readFileSync(csvPath, {encoding: "utf8"});
        csv.parse(csvText, {
            relax: true,
            delimiter: ';'
        }, function(err, data) {
            callback(err, data);
        });
    };

    var parseCsv = r.parseCsv = function(csvText, callback)
    {
        csv.parse(csvText, {
            relax: true
        }, function(err, data) {
            callback(err, data);
        });
    };

    var csv2text = r.csv2text = function(csvData, callback)
    {
        csv.stringify(csvData, {
            //quote: '"',
            //quoted: true,
            escape: '\\'
        }, function(err, csvText) {
            callback(err, csvText);
        });
    };

    var enhanceNode = r.enhanceNode = exports.enhanceNode = function(node)
    {
        if (!node || !node.__qname) return node;
        
        node._qname = node.__qname();
        node._type = node.__type();
        if (node._paths && Object.keys(node._paths).length) {
            node._filePath = _.values(node._paths)[0];
        }
        delete node._paths;
    
        // add in the "attachments" as a top level property
        // if "attachments" already exists, we'll set to "_attachments"
        var attachments = {};
        for (var id in node.getSystemMetadata()["attachments"])
        {
            var attachment = node.getSystemMetadata()["attachments"][id];
    
            attachments[id] = JSON.parse(JSON.stringify(attachment));
            attachments[id]["url"] = "/static/node/" + node.getId() + "/" + id;
            attachments[id]["preview32"] = "/static/node/" + node.getId() + "/preview32/?attachment=" + id + "&size=32";
            attachments[id]["preview64"] = "/static/node/" + node.getId() + "/preview64/?attachment=" + id + "&size=64";
            attachments[id]["preview128"] = "/static/node/" + node.getId() + "/preview128/?attachment=" + id + "&size=128";
            attachments[id]["preview256/"] = "/static/node/" + node.getId() + "/preview256/?attachment=" + id + "&size=256";
        }
    
        if (!node.attachments) {
            node.attachments = attachments;
        }
        else if (!node._attachments) {
            node._attachments = attachments;
        }
    
        // add in the "_system" block as a top level property
        if (node.getSystemMetadata) {
            node._system = node.getSystemMetadata();
        }
    };

    var downloadNode = r.downloadNode = function(platform, filePath, repositoryId, branchId, nodeId, attachmentId, callback) {
        // load asset from server, begin constructing the URI
        var uri = "/repositories/" + repositoryId + "/branches/" + branchId + "/nodes/" + nodeId;
        if (attachmentId) {
            uri += "/attachments/" + attachmentId;
        }
        // force content disposition information to come back
        uri += "?a=true";

        var agent = http.globalAgent;
        if (process.env.GITANA_PROXY_SCHEME === "https")
        {
            agent = https.globalAgent;
        }

        var fileWriteStream = fs.createWriteStream(filePath);
        var body = "";

        var URL = asURL(process.env.GITANA_PROXY_SCHEME, process.env.GITANA_PROXY_HOST, process.env.GITANA_PROXY_PORT) + uri;
        request({
            "method": "GET",
            "url": URL,
            "qs": {},
            "headers": {
                Authorization: platform.getDriver().getHttpHeaders().Authorization
            },
            "timeout": process.defaultHttpTimeoutMs,
            "agent": agent
        }).on('response', function (response) {
            if (response.statusCode >= 200 && response.statusCode <= 204) {
                response.pipe(fileWriteStream).on("close", function (err) {
                    if (err)
                    {
                        callback(err);
                        return;
                    }
                });
                
                response.on('data', function (chunk) {
                    fileWriteStream.write(body);
                });
            
                response.on('end', function () {

                    fileWriteStream.on('end', function() {
                        try { fileWriteStream.end(); } catch(e) { }
                    });
                    
                }).on('error', function (err) {
                    callback(err);                    
                }).on('end', function (err) {
                    callback();
                });
            }
        }).on("error", function (err) {
            try { fileWriteStream.end(); } catch(e) { }
            console.log("Pipe error: " + err);
        }).end();
    };

    parseGitana = r.parseGitana = function(gitanaJson) {
        var defaultGitanaProxyScheme = legacy.DEFAULT_GITANA_PROXY_SCHEME;
        var defaultGitanaProxyHost = legacy.DEFAULT_GITANA_PROXY_HOST;
        var defaultGitanaProxyPort = legacy.DEFAULT_GITANA_PROXY_PORT;

        if (gitanaJson && gitanaJson.baseURL)
        {
            var parsedUrl = url.parse(gitanaJson.baseURL);

            defaultGitanaProxyHost = parsedUrl.hostname;
            defaultGitanaProxyScheme = parsedUrl.protocol.substring(0, parsedUrl.protocol.length - 1); // remove the :

            if (parsedUrl.port)
            {
                defaultGitanaProxyPort = parsedUrl.port;
            }
            else
            {
                defaultGitanaProxyPort = 80;
                if (defaultGitanaProxyScheme === "https")
                {
                    defaultGitanaProxyPort = 443;
                }
            }
        }

        // init
        if (!process.env.GITANA_PROXY_SCHEME) {
            process.env.GITANA_PROXY_SCHEME = defaultGitanaProxyScheme;
        }
        if (!process.env.GITANA_PROXY_HOST) {
            process.env.GITANA_PROXY_HOST = defaultGitanaProxyHost;
        }
        if (!process.env.GITANA_PROXY_PORT) {
            process.env.GITANA_PROXY_PORT = defaultGitanaProxyPort;
        }
    };

    var asURL = r.asURL = function(protocol, host, port)
    {
        // make sure port is a number
        if (typeof(port) === "string") {
            port = parseInt(port, 10);
        }
    
        // protocol lower case
        protocol = protocol.toLowerCase();
    
        var url = protocol + "://" + host;
    
        // if port and default port don't match, then append
        if (protocol === "https" && port !== 443)
        {
            url += ":" + port;
        }
        else if (protocol === "http" && port !== 80)
        {
            url += ":" + port;
        }
    
        return url;
    };
        
return r;
    
}();
