const fs = require('fs');
const path = require('path');
const http = require('http');
const yargs = require('yargs');
const chalk = require('chalk');

const urlencodedRegex = /^([\w-%]+=[\w-%]*)(&[\w-%]+=[\w-%]*)*$/;

function logWARN(text) {
  console.log(chalk.keyword('orange').inverse('WARNING') + chalk.keyword('orange')(': ' + text));
}

function logERRORWrapper(text) {
  return chalk.keyword('red').inverse('ERROR') + chalk.keyword('red')(': ' + text);
}

function setupYargs() {
  yargs.check(({ _ }) => {
    if (_.length !== 1) {
      throw new Error(logERRORWrapper('You must provide a url'));
    }
    try {
      new URL(_[0]);
    } catch (e) {
      throw new Error(logERRORWrapper(e.message));
    }
    return true;
  });

  yargs.option('method', {
    alias: 'M',
    default: 'GET',
    describe: 'HTTP method for request to send',
    choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  });

  yargs.option('headers', {
    alias: 'H',
    default: [],
    array: true,
    describe: 'Headers for HTTP request, use as key1:value1 key2:value2 ...'
  }).coerce('headers', (headers) => {
    const parsedHeaders = {};
    for (const header of headers) {
      const splitPoint = header.indexOf(':');
      if (splitPoint === -1) {
        logWARN('Invalid header ' + header);
        continue;
      }
      const key = header.substring(0, splitPoint).toLowerCase();
      const value = header.substring(splitPoint + 1);
      if (parsedHeaders[key] !== undefined) {
        logWARN('Overwriting header key for ' + key);
      }
      parsedHeaders[key] = value;
    }
    return parsedHeaders;
  });

  yargs.option('queries', {
    alias: 'Q',
    default: [],
    array: true,
    describe: 'Query parameters for HTTP request, use as key1=value1&key2=value2 ...'
  }).coerce('queries', (queries) => {
    const parsedQueries = {};
    for (const query of queries) {
      const parts = query.split('&');
      for (const part of parts) {
        const splitPoint = part.indexOf('=');
        if (splitPoint === -1) {
          logWARN('Invalid query parameter ' + part);
          continue;
        }
        const key = part.substring(0, splitPoint);
        const value = part.substring(splitPoint + 1);
        if (parsedQueries[key] !== undefined) {
          logWARN('Overwriting query key for ' + key);
        }
        parsedQueries[key] = value;
      }
    }
    return parsedQueries;
  });

  yargs.option('data', {
    alias: 'D',
    describe: 'application/x-www-form-urlencoded body type data'
  }).check(({ data, json, file }) => {
    if (data !== undefined && (json !== undefined || file !== undefined)) {
      throw new Error(logERRORWrapper('Simultaneous usage of data and json or data and file is not permitted'));
    }
    if (data !== undefined) {
      if (!urlencodedRegex.test(data)) {
        logWARN('Invalid urlencoded body!');
      }
    }
    return true;
  });

  yargs.option('json', {
    describe: 'application/json body type data'
  }).check(({ data, json, file }) => {
    
    if (json !== undefined && (data !== undefined || file !== undefined)) {
      throw new Error(logERRORWrapper('Simultaneous usage of json and data or json and file is not permitted'));
    }
    if (json !== undefined) {
      try {
        JSON.parse(json);
      } catch (e) {
        logWARN('Invalid JSON body');
      }
    }
    return true;
  });

  yargs.option('file', {
    describe: 'application/octet-stream body type data (send file)'
  }).check(({ data, json, file }) => {
    if (file !== undefined && (data !== undefined || json !== undefined)) {
      throw new Error(logERRORWrapper('Simultaneous usage of file and data or file and json is not permitted'));
    }
    if (file !== undefined) {
      try {
        fs.readFileSync(path.resolve(file));
      } catch (e) {
        throw new Error(logERRORWrapper(e.message));
      }
    }
    return true;
  });

  yargs.option('timeout', {
    describe: 'Timeout time in seconds',
    type: 'number'
  }).check(({ timeout }) => {
    if(isNaN(timeout)) {
      throw new Error(logERRORWrapper('Timeout must be a number'));
    }
    return true;
  });

  return yargs.parse();
}

async function sendRequest(url, method = 'GET', headers = [], queries = [], body, json, filePath, timeout) {
  let file;
  if (body) {
    if(headers['content-type'] === undefined) headers['content-type'] = 'application/x-www-form-urlencoded';
    if(headers['content-length'] === undefined && method !== 'GET') headers['content-length'] = Buffer.byteLength(body);
  } else if (json) {
    if(headers['content-type'] === undefined) headers['content-type'] = 'application/json';
    if(headers['content-length'] === undefined && method !== 'GET') headers['content-length'] = Buffer.byteLength(json);
  } else if (filePath) {
    file = fs.readFileSync(path.resolve(filePath));
    if(headers['content-type'] === undefined) headers['content-type'] = 'application/octet-stream';
    if(headers['content-length'] === undefined && method !== 'GET') headers['content-length'] = Buffer.byteLength(file);
  }

  let requestPath = url.pathname;
  if (queries.length !== 0) {
    requestPath += '?';
    for(const key in queries) {
      requestPath += key + '=' + queries[key] + '&';
    }
    requestPath = requestPath.substring(0, requestPath.length - 1);
  }

  try {
    const request = http.request({
      hostname: url.hostname,
      port: '80',
      path: requestPath,
      headers,
      method,
      timeout
    }, res => {
      const rawBody = [];

      res.on('data', chunk => {
        rawBody.push(chunk);
      });

      res.on('end', () => {
        const body = Buffer.concat(rawBody).toString();
        console.log();
        console.log(chalk.keyword('green').inverse('-----------------RESPONSE-------------------'));
        console.log(chalk.keyword('cyan').inverse('METHOD') + chalk.keyword('cyan')(': ' + res.method));
        console.log(chalk.keyword('cyan').inverse('STATUS') + chalk.keyword('cyan')(': ' + res.statusCode + ' - ' + res.statusMessage));
        console.log(chalk.keyword('cyan').inverse('HEADERS') + chalk.keyword('cyan')(': '));
        for(const header in res.headers) {
          console.log('\t' + chalk.keyword('blue').inverse(header) + chalk.keyword('blue')(': ' + res.headers[header]));
        }
        console.log(chalk.keyword('lightgreen').inverse('BODY') + chalk.keyword('lightgreen')(': ' + body));
      });

      res.on('error', (err) => {
        console.log(logERRORWrapper(err.message));
      });
    });
    
    if(body) {
      request.write(body);
    } else if(json) {
      request.write(json);
    } else if(file) {
      request.write(file);
    }

    request.end();
  } catch (e) {
    console.log(logERRORWrapper(e.message));
  }
}


function main() {
  process.on('uncaughtException', function (err) {
    console.log(logERRORWrapper(err.message));
  });
  const args = setupYargs();
  sendRequest(new URL(args._[0]), args.method, args.headers, args.queries, args.body, args.json, args.file, args.timeout);
}

main();
