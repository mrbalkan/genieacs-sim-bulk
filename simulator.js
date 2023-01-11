"use strict";

const net = require("net");
const xmlParser = require("./xml-parser");
const xmlUtils = require("./xml-utils");
const methods = require("./methods");
const v = require("./value-functions.js");

const NAMESPACES = {
  "soap-enc": "http://schemas.xmlsoap.org/soap/encoding/",
  "soap-env": "http://schemas.xmlsoap.org/soap/envelope/",
  "xsd": "http://www.w3.org/2001/XMLSchema",
  "xsi": "http://www.w3.org/2001/XMLSchema-instance",
  "cwmp": "urn:dslforum-org:cwmp-1-0"
};

let nextInformTimeout = null;
let pendingInform = false;
let http = null;
let requestOptions = null;
let device = null;
let httpAgent = null;
let basicAuth;

function createSoapDocument(id, body) {
  let headerNode = xmlUtils.node(
    "soap-env:Header",
    {},
    xmlUtils.node("cwmp:ID", { "soap-env:mustUnderstand": 1 }, xmlParser.encodeEntities(id))
  );

  let bodyNode = xmlUtils.node("soap-env:Body", {}, body);
  let namespaces = {};
  for (let prefix in NAMESPACES)
    namespaces[`xmlns:${prefix}`] = NAMESPACES[prefix];
  
  let env = xmlUtils.node("soap-env:Envelope", namespaces, [headerNode, bodyNode]);

  return `<?xml version="1.0" encoding="UTF-8"?>\n${env}`;
}

function sendRequest(xml, callback) {
  let headers = {};
  let body = xml || "";

  headers["Content-Length"] = body.length;
  headers["Content-Type"] = "text/xml; charset=\"utf-8\"";
  headers["Authorization"]= basicAuth;

  if (device._cookie)
    headers["Cookie"] = device._cookie;

  let options = {
    method: "POST",
    headers: headers,
    agent: httpAgent
  };

  Object.assign(options, requestOptions);

  let request = http.request(options, function(response) {
    let chunks = [];
    let bytes = 0;

    response.on("data", function(chunk) {
      chunks.push(chunk);
      return bytes += chunk.length;
    });

    return response.on("end", function() {
      let offset = 0;
      body = Buffer.allocUnsafe(bytes);

      chunks.forEach(function(chunk) {
        chunk.copy(body, offset, 0, chunk.length);
        return offset += chunk.length;
      });

      if (Math.floor(response.statusCode / 100) !== 2) {
        throw new Error(
          `Unexpected response Code ${response.statusCode}: ${body}`
        );
      }

      if (+response.headers["Content-Length"] > 0 || body.length > 0)
        xml = xmlParser.parseXml(body.toString());
      else
        xml = null;

      if (response.headers["set-cookie"])
        device._cookie = response.headers["set-cookie"];

      return callback(xml);
    });
  });

  request.setTimeout(30000, function(err) {
    throw new Error("Socket timed out");
  });

  return request.end(body);
}

function startSession(event) {
  nextInformTimeout = null;
  pendingInform = false;
  const requestId = Math.random().toString(36).slice(-8);

  methods.inform(device, event, function(body) {
    let xml = createSoapDocument(requestId, body);
    sendRequest(xml, function(xml) {
      cpeRequest();
    });
  });
}


function createFaultResponse(code, message) {
  let fault = xmlUtils.node(
    "detail",
    {},
    xmlUtils.node("cwmp:Fault", {}, [
      xmlUtils.node("FaultCode", {}, code),
      xmlUtils.node("FaultString", {}, xmlParser.encodeEntities(message))
    ])
  );

  let soapFault = xmlUtils.node("soap-env:Fault", {}, [
    xmlUtils.node("faultcode", {}, "Client"),
    xmlUtils.node("faultstring", {}, "CWMP fault"),
    fault
  ]);

  return soapFault;
}


function cpeRequest() {
  const pending = methods.getPending();
  if (!pending) {
    sendRequest(null, function(xml) {
      handleMethod(xml);
    });
    return;
  }

  const requestId = Math.random().toString(36).slice(-8);

  pending(function(body, callback) {
    let xml = createSoapDocument(requestId, body);
    sendRequest(xml, function(xml) {
      callback(xml, cpeRequest);
    });
  });
}


function handleMethod(xml) {
  if (!xml) {
    httpAgent.destroy();
    let informInterval = 10;
    if (device["Device.ManagementServer.PeriodicInformInterval"])
      informInterval = parseInt(device["Device.ManagementServer.PeriodicInformInterval"][1]);
    else if (device["InternetGatewayDevice.ManagementServer.PeriodicInformInterval"])
      informInterval = parseInt(device["InternetGatewayDevice.ManagementServer.PeriodicInformInterval"][1]);

    nextInformTimeout = setTimeout(function() {
      startSession();
    }, pendingInform ? 0 : 1000 * informInterval);
    return;
  }

  let headerElement, bodyElement;
  let envelope = xml.children[0];
  for (const c of envelope.children) {
    switch (c.localName) {
      case "Header":
        headerElement = c;
        break;
      case "Body":
        bodyElement = c;
        break;
    }
  }

  let requestId;
  for (let c of headerElement.children) {
    if (c.localName === "ID") {
      requestId = xmlParser.decodeEntities(c.text);
      break;
    }
  }

  let requestElement;
  for (let c of bodyElement.children) {
    if (c.name.startsWith("cwmp:")) {
      requestElement = c;
      break;
    }
  }
  let method = methods[requestElement.localName];

  if (!method) {
    let body = createFaultResponse(9000, "Method not supported-" + requestElement.localName);
    let xml = createSoapDocument(requestId, body);
    sendRequest(xml, function(xml) {
      handleMethod(xml);
    });
    return;
  }

  method(device, requestElement, function(body) {
    let xml = createSoapDocument(requestId, body);
    sendRequest(xml, function(xml) {
      handleMethod(xml);
    });
  });
}

function listenForConnectionRequests(serialNumber, acsUrlOptions, callback) {
  let ip, port;
  // Start a dummy socket to get the used local ip
  let socket = net.createConnection({
    port: acsUrlOptions.port,
    host: acsUrlOptions.hostname,
    family: 4
  })
  .on("error", callback)
  .on("connect", () => {
    ip = socket.address().address;
    port = socket.address().port + 1;
    socket.end();
  })
  .on("close", () => {
    const connectionRequestUrl = `http://${ip}:${port}/`;

    const httpServer = http.createServer((_req, res) => {
      console.log(`Simulator ${serialNumber} got connection request`);
      res.end();
        // A session is ongoing when nextInformTimeout === null
        if (nextInformTimeout === null) pendingInform = true;
        else {
          clearTimeout(nextInformTimeout);
          nextInformTimeout = setTimeout(function () {
            startSession("6 CONNECTION REQUEST");
          }, 0);
        }
    });

    httpServer.listen(port, ip, err => {
      if (err) return callback(err);
      console.log(
        `Simulator ${serialNumber} listening for connection requests on ${connectionRequestUrl}`
      );
      return callback(null, connectionRequestUrl);
    });
  });
}

function getSortedPaths(device) {
  if (device._sortedPaths) return device._sortedPaths;
  const ignore = new Set(["DeviceID", "Downloads", "Tags", "Events", "Reboot", "FactoryReset", "VirtalParameters"]);
  device._sortedPaths = Object.keys(device).filter(p => p[0] !== "_" && !ignore.has(p.split(".")[0])).sort();
  return device._sortedPaths;
}

function postHTTPIot() {
  let pathName="InternetGatewayDevice.DeviceInfo.DemoMode";
    if(device[pathName][1] === "true"){
      //check if 3rd host is already added.
      pathName="InternetGatewayDevice.LANDevice.1.Hosts.Host.3.HostName"
      if(device[pathName] === undefined){
 		 let objectName = "InternetGatewayDevice.LANDevice.1.Hosts.Host.";
  		 let instanceNumber = 1;
  		 while (device[`${objectName}${instanceNumber}.`])
    			instanceNumber += 1;
    		 device[`${objectName}${instanceNumber}.`] = [true];
    		const defaultValues = {
    			"xsd:boolean": "false",
    			"xsd:int": "0",
    			"xsd:unsignedInt": "0",
    			"xsd:dateTime": "0001-01-01T00:00:00Z"
   		 };
    		for (let p of getSortedPaths(device)) {
      			if (p.startsWith(objectName) && p.length > objectName.length) {
        			let n = `${objectName}${instanceNumber}${p.slice(p.indexOf(".", objectName.length))}`;
        			if (!device[n])
          				device[n] = [device[p][0], defaultValues[device[p][2]] || "", device[p][2]];
        		}
    		 }
    		delete device._sortedPaths;
	  
	  device["InternetGatewayDevice.LANDevice.1.Hosts.Host.3.Active"] = [ true, 'true', 'xsd:boolean'];
	  device["InternetGatewayDevice.LANDevice.1.Hosts.Host.3.AddressSource"] = [ true, 'DHCP', 'xsd:string'];
	  device["InternetGatewayDevice.LANDevice.1.Hosts.Host.3.HostName"] = [ true, 'iphone-887bf88d22e66acc', 'xsd:string'];
	  device["InternetGatewayDevice.LANDevice.1.Hosts.Host.3.IPAddress"] = [ true, '192.168.1.99', 'xsd:string'];
	  device["InternetGatewayDevice.LANDevice.1.Hosts.Host.3.Layer2Interface"] = [ true, 'InternetGatewayDevice.LANDevice.3.WLANConfiguration.1', 'xsd:string'];
	  device["InternetGatewayDevice.LANDevice.1.Hosts.Host.3.LeaseTimeRemaining"] = [ true, '900922', 'xsd:string'];
	  device["InternetGatewayDevice.LANDevice.1.Hosts.Host.3.MACAddress"] = [ true, '40:50:4A:8B:4A:40', 'xsd:string'];
      }
    }

  //iterate through first 5 BDPs to see if they are enabled. If they are not, skip to the next Profile
  for(let i=1;i<6;i++){
    pathName="InternetGatewayDevice.BulkData.Profile."+i+".Enable";
    if(device[pathName] === undefined){
      break;
    }
    if(device[pathName][1]==='true'){
        //Enabled profile found. Check if any Parameter is defined.
        pathName="InternetGatewayDevice.BulkData.Profile."+i+".Parameter.1.Name";
	let url,username,password;
	if(device[pathName] === undefined || device[pathName][1]==="")
	        continue;
	else
	{
                pathName="InternetGatewayDevice.BulkData.Profile."+i+".HTTP.Password";
		password=device[pathName][1];
		pathName="InternetGatewayDevice.BulkData.Profile."+i+".HTTP.URL";
		url=device[pathName][1];
		pathName="InternetGatewayDevice.BulkData.Profile."+i+".HTTP.Username";
		username=device[pathName][1];
		//get metric names and push them into a list
                let kpis = [];
		for(let iparam=1;iparam<99;iparam++){
			pathName="InternetGatewayDevice.BulkData.Profile."+i+".Parameter."+iparam+".Name";
			if(device[pathName] === undefined) {
				break;
			}	
			let kpiName=device[pathName][1];
			let kpiValueFunction="stableVal(15)"; //default
			//get value function for this kpi.
			pathName="InternetGatewayDevice.BulkData.Profile."+i+".Parameter."+iparam+".ValueFunction";
			if(device[pathName] !== undefined) {
                                kpiValueFunction=device[pathName][1];
                        }
			let myObj={
				KpiName: kpiName,
				KpiValueFunction: kpiValueFunction
			};
			kpis.push(myObj);
		}//for
		if(kpis.length>0)
			processKpis(kpis,url,username,password);
	}//if any parameter is defined
    }//if enabled
  }//for
}

function processKpis(kpis,url,username,password){
	//determine the next value for each param and construct the report.
	let jsonObj={};
	jsonObj["CollectionTime"]=Math.floor(Date.now() / 1000);
	jsonObj["DeviceID.ID"]=device["InternetGatewayDevice.DeviceInfo.ManufacturerOUI"][1] + "-" + device["InternetGatewayDevice.DeviceInfo.ProductClass"][1] + "-" + device["InternetGatewayDevice.DeviceInfo.SerialNumber"][1];
        for(var i=0;i<kpis.length;i++){
		let obj=kpis[i];
		let lastval=device[obj.KpiName][1];
		if(!obj.KpiValueFunction.startsWith("v.")) continue;
		let simulated_val=eval(obj.KpiValueFunction.replace("<lastval>",lastval));
		jsonObj[obj.KpiName]=simulated_val.toString();
		device[obj.KpiName][1]=simulated_val.toString();
	}
	let reportArry=[jsonObj];
	let jsonData={
		Report : reportArry
	};
	let pathData="oui="+ device["InternetGatewayDevice.DeviceInfo.ManufacturerOUI"][1] + "&pc=" + device["InternetGatewayDevice.DeviceInfo.ProductClass"][1] + "&sn=" + device["InternetGatewayDevice.DeviceInfo.SerialNumber"][1];
	postBulkData(url,username,password,JSON.stringify(jsonData),pathData);
}

function stripTrailingSlash(str) {
    if(str.substr(-1) === '/') {
        return str.substr(0, str.length - 1);
    }
    return str;
}

async function postBulkData(url,username,password,jsonData,pathData) {
    let m_url=stripTrailingSlash(url);
    if(m_url.indexOf('?')>-1) 
	m_url=m_url + "&" + pathData;
    else
	m_url=m_url + "?" + pathData;
    //console.log ("Posting to " + m_url);
    const https = require('https');
    const auth= Buffer.from(username + ':' + password, "utf8").toString("base64");
    const options = {
        port: 443,
	timeout: 2000,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': jsonData.length,
	    'Authorization' : auth
        },
    };
    let p = new Promise((resolve, reject) => {
        const req = https.request(m_url, options, (res) => {
            res.setEncoding('utf8');
            let responseBody = '';

            res.on('data', (chunk) => {
                responseBody += chunk;
            });

            res.on('end', () => {
		//console.log(responseBody);
                resolve(JSON.parse(responseBody));
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.write(jsonData)
        req.end();
    });
    return await p;
}

function start(dataModel, serialNumber, acsUrl) {
  device = dataModel;
 //start the collector timer every 10 seconds.
 setInterval(postHTTPIot, 10000);

  if (device["DeviceID.SerialNumber"])
    device["DeviceID.SerialNumber"][1] = serialNumber;
  if (device["Device.DeviceInfo.SerialNumber"])
    device["Device.DeviceInfo.SerialNumber"][1] = serialNumber;
  if (device["InternetGatewayDevice.DeviceInfo.SerialNumber"])
    device["InternetGatewayDevice.DeviceInfo.SerialNumber"][1] = serialNumber;

  let username = "";
  let password = "";
  if (device["Device.ManagementServer.Username"]) {
    username = device["Device.ManagementServer.Username"][1];
    password = device["Device.ManagementServer.Password"][1];
  } else if (device["InternetGatewayDevice.ManagementServer.Username"]) {
    username = device["InternetGatewayDevice.ManagementServer.Username"][1];
    password = device["InternetGatewayDevice.ManagementServer.Password"][1];
  }

  basicAuth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  requestOptions = require("url").parse(acsUrl);
  http = require(requestOptions.protocol.slice(0, -1));
  httpAgent = new http.Agent({keepAlive: true, maxSockets: 1});

  listenForConnectionRequests(serialNumber, requestOptions, (err, connectionRequestUrl) => {
    if (err) throw err;
    if (device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"]) {
      device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"][1] = connectionRequestUrl;
    } else if (device["Device.ManagementServer.ConnectionRequestURL"]) {
      device["Device.ManagementServer.ConnectionRequestURL"][1] = connectionRequestUrl;
    }
    startSession();
  });
}

exports.start = start;
