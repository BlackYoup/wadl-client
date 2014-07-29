var WadlClient = (function() {
  /* Dependency aliases (to make WadlClient work on both node and browser environments) */
  var B = typeof require == "function" && require("baconjs") ? require("baconjs") : Bacon;
  var request = typeof XMLHttpRequest != "undefined" ? null : require("request");
  var parser = typeof XMLHttpRequest != "undefined" ? null : require("xml2json");

  /* Utils */
  var Utils = {};

  Utils.any = function(values, f) {
    for(var i in values) {
      var result = f(values[i]);

      if(result) {
        return result;
      }
    }

    return false;
  };

  Utils.elem = function(array, values) {
    return Utils.any(values, function(value) {
      return array.indexOf(value) >= 0;
    });
  };

  Utils.parseBody = function(response, body) {
    var contentType = typeof XMLHttpRequest != "undefined" ? response.getResponseHeader("Content-Type") : response.headers["content-type"];

    if(Utils.elem(contentType || "", ["application/json"])) {
      return JSON.parse(typeof response.responseText != "undefined" ? response.responseText : body);
    }
    else if(Utils.elem(contentType || "", ["text/xml", "application/rss+xml", "application/rdf+xml", "application/atom+xml"])) {
      return response.responseXML ? response.responseXML : parser.toJson(body, {
        object: true,
        arrayNotation: true
      });
    }
    else {
      return response.responseText || body;
    }
  };

  Utils.querystring = function(params) {
    var pairs = [];
    params = params || {};

    for(var name in params) {
      if(params.hasOwnProperty(name)) {
        pairs.push(typeof params[name] != "undefined" ? encodeURIComponent(name) + "=" + encodeURIComponent(params[name]) : encodeURIComponent(name));
      }
    }

    return pairs.length === 0 ? "" : "?" + pairs.join("&");
  };

  Utils.send = function(sink, data) {
    sink(data);
    sink(new B.End());
  };

  var WadlClient = {};

  /* Redefine request for node environment */
  var sendNodeRequest = function(options) {
    return B.fromBinder(function(sink) {
      request(options, function(error, response, body) {
        if(error) {
          Utils.send(sink, new B.Error(error));
        }
        else if(response.statusCode >= 200 && response.statusCode < 300) {
          Utils.send(sink, options.parse ? Utils.parseBody(response, body) : body);
        }
        else {
          Utils.send(sink, new B.Error(options.parse ? Utils.parseBody(response, body) : body));
        }
      });

      return function(){};
    });
  };

  /* Redefine request for browser environment */
  var sendBrowserRequest = function(options) {
    options = options || {};
    options.headers = options.headers || {};

    return B.fromBinder(function(sink) {
      var xhr = new XMLHttpRequest();

      xhr.onreadystatechange = function() {
        if(xhr.readyState == 4) {
          if(xhr.status >= 200 && xhr.status < 300) {
            Utils.send(sink, options.parse ? Utils.parseBody(xhr) : xhr.responseText);
          }
          else {
            Utils.send(sink, new B.Error(options.parse ? Utils.parseBody(xhr) : xhr.responseText));
          }
        }
      };

      xhr.open(options.method || "GET", options.uri + Utils.querystring(options.qs));

      for(var name in options.headers) {
        if(options.headers.hasOwnProperty(name)) {
          xhr.setRequestHeader(name, options.headers[name]);
        }
      }

      xhr.send(options.body);

      return function(){};
    });
  };

  var sendRequest = function(options) {
    var host = options.host || "";
    var headers = options.headers || {};
    var parse = options.parse || false;

    return function(verb, path_template) {
      return function() {
        var params = Array.apply(Array, arguments);
        var path = path_template.replace(/{[^}]*}/g, function(matched) {
          var param = params.shift();
          return typeof param != "undefined" ? param : matched;
        });

        return function(data) {
          var userOptions = typeof data == "object" && data;
          var qs = userOptions && userOptions.query;
          host = userOptions ? (userOptions.host || host) : host;
          headers = userOptions ? (userOptions.headers || headers) : headers;

          return (request ? sendNodeRequest : sendBrowserRequest)({
            uri: host + path,
            method: verb.toUpperCase(),
            headers: headers,
            qs: qs,
            body: userOptions ? userOptions.data : data,
            parse: parse
          });
        };
      };
    };
  };

  var buildNodeFromSegments = function(node, segments) {
    var segment = segments[0];

    if(segment) {
      node[segment] = node[segment] || {};
      return buildNodeFromSegments(node[segment], segments.slice(1));
    }
    else {
      return node;
    }
  };

  WadlClient.buildClient = function(endpoints, settings) {
    var client = {};

    for(var path in endpoints) {
      if(endpoints.hasOwnProperty(path)) {
        var formattedPath = path.replace(/{[^}]*}/g, "_");
        formattedPath = formattedPath[0] == "/" ? formattedPath.slice(1) : formattedPath;
        formattedPath = formattedPath[formattedPath.length - 1] == "/" ? formattedPath.slice(0, formattedPath.length - 1) : formattedPath;

        var segments = formattedPath.split("/");
        var node = buildNodeFromSegments(client, segments);

        var methods = endpoints[path];
        for(var i = 0; i < methods.length; i++) {
          var method = methods[i];
          node[method.verb == "DELETE" ? "remove" : method.verb.toLowerCase()] = sendRequest(settings)(method.verb, path);
        }
      }
    }

    return client;
  };

  return WadlClient;
})();

/* Export WadlClient if we are in a node environment */
if(typeof module != "undefined" && module.exports) {
  module.exports = WadlClient;
}
