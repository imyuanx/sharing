const express = require('express');
const fileUpload = require('express-fileupload');
const basicAuth = require('express-basic-auth');
const handler = require('serve-handler');
const fs = require('fs');
const _path = require("path");
const crypto = require('crypto');

const config = require('./config');
const utils = require('./utils');

const start = ({ port, path, receive, onStart, postUploadRedirectUrl, shareAddress }) => {
    const app = express();

    // Basic Auth
    if (config.auth.username && config.auth.password) {
        app.use(basicAuth({
            challenge: true,
            realm: 'sharing',
            users: { [config.auth.username]: config.auth.password }
        }));
    }

    // Routing
    if (receive) {
        app.use(fileUpload());

        app.get('/receive', (req, res) => {
            const form = fs.readFileSync(`${__dirname}/receive-form.html`);
            res.send(form.toString().replace(/\{shareAddress\}/, shareAddress));
        });

        app.post('/upload', (req, res) => {
            if (!req.files || Object.keys(req.files).length === 0) {
                res.status(400).send('No files were received.');
                return;
            }

            const selectedFile = req.files.selected;

            const uploadPath = _path.resolve(__dirname, path[0]) + '/' + selectedFile.name;
            utils.debugLog(`upload path: ${uploadPath}`);

            selectedFile.mv(uploadPath).then(err => {
                if (err) {
                    return res.status(500).send(err);
                }

                console.log(`File recevied: ${uploadPath}`)

                res.send(`
                    <script>
                        window.alert('Shared at ${uploadPath}');
                        window.location.href = '${postUploadRedirectUrl}';
                    </script>
                `);
            });
        });
    }
    
    app.use('/share', (req, res) => {
        // handler(req, res, { public: path, etag: true, prefix: '/share' });
        const form = fs.readFileSync(`${__dirname}/index.html`);
        const pathList = path.map((pathItem) => {
            let type = "folder";
            const baseName = _path.basename(pathItem);
            const isFile = fs.lstatSync(pathItem).isFile();
            if (isFile) {
                type = _path.extname(pathItem).replace('.', '');
                pathItem = _path.dirname(pathItem);
            }
            const route = crypto.createHash('md5').update(pathItem).digest('hex');
            return { name: `${baseName}/`, url:  `/folder/${route}/${isFile ? baseName : ''}`, type: type};
        });
        res.send(form.toString().replace(/\"\{pathList\}\"/, JSON.stringify(pathList)));
    });

    const dirPathList = Array.from(new Set(path.map(item => fs.lstatSync(item).isFile() ? _path.dirname(item) : item)));
    dirPathList.map((pathItem) => {
        const hash =  crypto.createHash('md5').update(pathItem).digest('hex');
        const route = `/folder/${hash}`;
        app.use(route, (req, res) => {
            handler(req, res, { public: pathItem, etag: true, prefix: route });
        });
    });

    // Listen
    config.ssl.protocolModule.createServer(config.ssl.option, app).listen(port, onStart);

}

module.exports = { 
    start
};
