var http = require('http');
var dispatcher = require('httpdispatcher');
var $http_request = require('request');

const SERVER_PORT = 8080;
const ZAPIER_URL = "https://zapier.com/hooks/catch/39fju3/";

var accessToken;

function onRequest(request, response){
    try {
        console.log("[Request] URL:" + request.url);
        dispatcher.dispatch(request, response);
    } catch(err) {
        console.log("[Error] " + err);
    }
}

function setupServer()
{
  var server = http.createServer(onRequest);

  server.listen(SERVER_PORT, function(){
      console.log("Server listening on: http://localhost:%s", SERVER_PORT);
  });
}

function extend(target) {
    var sources = [].slice.call(arguments, 1);
    sources.forEach(function (source) {
        for (var prop in source) {
            target[prop] = source[prop];
        }
    });
    return target;
}

function requestAuthTicket(callback)
{
  $http_request.post(
    {
      headers: {
        'Content-Type': 'application/json'
      },
      uri: 'https://home.mozu.com/api/platform/applications/authtickets',
      form: {
        'ApplicationId': 'nov14bc1.codepens.1.0.0.release',
        'SharedSecret': '7dcebef81ef34c059611f8de796b801d'
      }
    },
    function(error, res, body)
    {
      if(error)
      {
        console.log("[Error] Error getting auth ticket: " + body)
      }
      else
      {
        parsedBody = JSON.parse(body);
        accessToken = parsedBody["accessToken"];
        callback();
      }
    }
  )
}

function requestProductDetails(extraHeaders, entityId, rootURL, callback, errorCallback)
{
  var finalURL = "https://" + rootURL + "/api/commerce/catalog/storefront/products/" + entityId + "?contextLevel=Site";
  console.log("[INFO] Final URL: " + finalURL);
  
  var requestHeader =
  {
    'x-vol-app-claims': accessToken
  };
  
  var finalHeaders = extend({}, extraHeaders, requestHeader)
  
  $http_request( { headers: finalHeaders, uri: finalURL, method: "GET" },
    function(error, response, body)
    {
      if(!error && response.statusCode == 200)
      {
        console.log("[INFO] Good result from server");
        callback(JSON.parse(body));
      }
      else
      {
        console.log("[Error] GET returned: " + response.statusCode + " - " + body);
        errorCallback(response.statusCode, body);
      }
    }
  );
}

function zap(data, callback, errorCallback)
{
  $http_request( { headers: {'Content-Type': 'text/json'}, uri: ZAPIER_URL, method: "POST", form: data },
    function(error, response, body)
    {
      if(!error && response.statusCode == 200)
      {
        console.log("[INFO] Zap succeeded");
        callback(body);
      }
      else
      {
        console.log("[Error] GET returned: " + response.statusCode + " - " + body);
        errorCallback(response.statusCode, body);
      }
    }
  );
}

function zapProduct(req, successCallback, errorCallback)
{
  var formData = JSON.parse(req.body);
  
  var entityId = formData.entityId;
  var storeURL = req.headers["x-vol-tenant-domain"];
  var topic = formData.topic;
  
  console.log("[INFO] Entity ID: " + entityId);
  console.log("[INFO] Server: " + storeURL);
  
  var specialHeaders = {}
  
  for(var headerName in req.headers)
  {
    if(headerName.indexOf("x-vol") != -1)
    {
      specialHeaders[headerName] = req.headers[headerName];
    }
  }
  
  requestProductDetails(
    specialHeaders,
    entityId,
    storeURL,
    function productCallback(data)
    {
      zap_info = 
      {
        "mozu-tenant": req.headers["x-vol-tenant"],
        "mozu-site": req.headers["v-vol-site"],
        "mozu-action": topic,
        "data": data
      }
      
      zap(
        zap_info,
        function(zap_result)
        {
          successCallback(JSON.stringify(data));
        },
        function onError(code, message)
        {
          errorCallback(code, message)
        }
       );
    },
    function onError(code, message)
    {
      errorCallback(code, message)
    }
  );
}

requestAuthTicket(function()
{
  console.log("[INFO] Got access token: " + accessToken);
  setupServer();
});

dispatcher.onPost("/trigger", requestAndSendProduct);

function requestAndSendProduct(req, res, isRetry) {
  if(isRetry === undefined)
    isRetry = false;

  zapProduct(
    req,
    function onSuccess()
    {
      res.writeHead(200, {'Content-Type': 'text/json'});
      res.end("{success: true}");
    },
    function onError(code, message)
    {
      console.log("[Error]");
      var errorData = JSON.parse(message);
      var errorCode = (errorData.items[0] === undefined) ? "" : errorData.items[0].errorCode;
	  
      if(code == 401 && errorCode == "INVALID_ACCESS_TOKEN" && !isRetry)
      {
        console.log("[INFO] Discarding expired auth token");
        //If the result from the server says that we have an invalid access token, we go grab a new one
        requestAuthTicket(function()
        {
          requestAndSendProduct(req, res, true);
        });
      }
      else
      {
        res.writeHead(500, {'Content-Type': 'text/json'});
        res.end(message);
      }
    }
  );
}
