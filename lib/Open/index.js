var fs = require('graceful-fs');
var Promise = require('bluebird');
var directory = require('./directory');
var Stream = require('stream');

// Backwards compatibility for node versions < 8
if (!Stream.Writable || !Stream.Writable.prototype.destroy)
  Stream = require('readable-stream');

module.exports = {
  buffer: function(buffer, options) {
    var source = {
      stream: function(offset, length) {
        var stream = Stream.PassThrough();
        stream.end(buffer.slice(offset, length));
        return Promise.resolve(stream);
      },
      size: function() {
        return Promise.resolve(buffer.length);
      }
    };
    return directory(source, options);
  },
  file: function(filename, options) {
    var source = {
      stream: function(offset,length) {
        return Promise.resolve(fs.createReadStream(filename,{start: offset, end: length && offset+length}));
      },
      size: function() {
        return new Promise(function(resolve,reject) {
          fs.stat(filename,function(err,d) {
            if (err)
              reject(err);
            else
              resolve(d.size);
          });
        });
      }
    };
    return directory(source, options);
  },

  url: function(request, params, options) {
    if (typeof params === 'string')
      params = {url: params};
    if (!params.url)
      throw 'URL missing';
    params.headers = params.headers || {};

    var source = {
      stream: function(offset,length) {
        var options = Object.create(params);
        options.headers = Object.create(params.headers);
        options.headers.range = 'bytes='+offset+'-' + (length ? length : '');
        return Promise.resolve(request(options));
      },
      size: function() {
        return new Promise(function(resolve,reject) {
          var req = request(params);
          req.on('response',function(d) {
            req.abort();
            if (!d.headers['content-length'])
              reject(new Error('Missing content length header'));
            else
              resolve(d.headers['content-length']);
          }).on('error',reject);
        });
      }
    };

    return directory(source, options);
  },

  s3: function(client, params, options) {
    // detect aws-sdk v2 or aws-sdk v3
    const isAwsSdkV3 = client.getObject.constructor.name === "AsyncFunction";

    var source = {
      size: function() {
        if (isAwsSdkV3) {
          return client.headObject(params).then(function (res) {
            return res.ContentLength;
          });
        }
        return client.headObject(params).promise().then(function (res) {
          return res.ContentLength;
        });
      },
      stream: function(offset, length) {
        var d = {};
        for (var key in params)
          d[key] = params[key];
        d.Range = 'bytes='+offset+'-' + (length ? length : '');
        if (isAwsSdkV3) {
          return client.getObject(d).then(function (res) {
            return res.Body;
          })
        }
        return Promise.resolve(client.getObject(d).createReadStream());
      }
    };

    return directory(source, options);
  },

  custom: function(source, options) {
    return directory(source, options);
  }
};
