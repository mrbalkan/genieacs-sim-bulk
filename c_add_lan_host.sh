curl -i 'http://localhost:7557/devices/202BC1-BM632w-100001/tasks?connection_request' \
-X POST \
--data '{"name":"setParameterValues", "parameterValues": [["InternetGatewayDevice.DeviceInfo.DemoMode","true", "xsd:boolean"]]}'

sleep 10

curl -i 'http://localhost:7557/devices/202BC1-BM632w-100001/tasks?connection_request' \
-X POST \
--data '{"name": "refreshObject", "objectName": "InternetGatewayDevice.LANDevice.1.Hosts.Host"}'
