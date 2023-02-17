const express = require('express');
const fileUpload = require('express-fileupload');
const basicAuth = require('express-basic-auth');
const handler = require('serve-handler');
const fs = require('fs');
const _path = require("path");
const crypto = require('crypto');

const config = require('./config');
const utils = require('./utils');

/**
 * @desc move file in request
 */
const mvFiles = async (path, files) => {
  const selectedFiles = Array.isArray(files) ? files : [files];
  let mvTask = [];
  for (let i = 0; i < selectedFiles.length; i++) {
    const selectedFile = selectedFiles[i];
    const selectedFileName = new Buffer(selectedFile.name, 'ascii').toString('utf8');
    const uploadPath = _path.resolve(__dirname, path) + '/' + selectedFileName;
    utils.debugLog(`upload path: ${uploadPath}`);
    mvTask.push(new Promise((resolve, reject) => {
      selectedFile.mv(uploadPath).then((err) => err ? reject({ uploadPath, err }) : resolve({ uploadPath }));
    }));
  }
  const mvRes = await Promise.allSettled(mvTask);
  const fulfilledList = mvRes.filter(({ status }) => status === 'fulfilled');
  const rejectedList = mvRes.filter(({ status }) => status === 'rejected');
  return { fulfilledList, rejectedList };
}

const start = ({ port, path, receive, clipboard, updateClipboardData, onStart, postUploadRedirectUrl, shareAddress }) => {
    const app = express();

    // Basic Auth
    if (config.auth.username && config.auth.password) {
        app.use(basicAuth({
            challenge: true,
            realm: 'sharing',
            users: { [config.auth.username]: config.auth.password }
        }));
    }

    app.get('/', (req, res) => {
        if (receive) {
            res.redirect('/receive');
        } else if (clipboard) {
            const clipboardPath = _path.dirname(path[0]);
            const hash = crypto.createHash('md5').update(clipboardPath).digest('hex');
            const route = `/folder/${hash}/.clipboard-tmp`;
            res.redirect(route);
        } else {
            res.redirect(`/share?time=${new Date().getTime()}`);
        }
    });

    // Routing
    if (receive) {
        app.use(fileUpload());

        app.get('/receive', (req, res) => {
            const form = fs.readFileSync(`${__dirname}/receive-form.html`);
            res.send(form.toString().replace(/\{shareAddress\}/, shareAddress));
        });

        app.post('/upload', async (req, res) => {
            if (!req.files || Object.keys(req.files).length === 0) {
                res.status(400).send('No files were received.');
                return;
            }
            const { fulfilledList, rejectedList } = await mvFiles(path[0], req.files.selected);
            const fulfilledMsg = fulfilledList.map(({ value: { uploadPath } }) => uploadPath).join(',\n');
            const rejectedMsg = rejectedList.map(({ reason: { uploadPath } }) => uploadPath).join(',\n');
            const successMsg = fulfilledList.length !== 0 ? `Shared at \n ${fulfilledMsg}` : ""
            const errorMsg = rejectedList.length !== 0 ? `${successMsg ? `\n\r`: ""}Sharing failed: \n ${rejectedMsg}` : "";
            res.send(`
                <script>
                    window.alert(\`${successMsg}${errorMsg}\`);
                    window.location.href = '${postUploadRedirectUrl}';
                </script>
            `);
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
            if (clipboard) {
              updateClipboardData();
              res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            }
            if (req.path!== '/') {
                console.log({ success: true, type: 'DOWNLOAD', data: { name: _path.basename(req.path), path: req.path }, msg: `Download: ${req.path}` });
            }
            handler(req, res, { public: pathItem, etag: true, prefix: route });
        });
    });

    // Listen
    config.ssl.protocolModule.createServer(config.ssl.option, app).listen(port, onStart);

}

module.exports = { 
    start
};
