curl -i 'http://localhost:7557/devices/202BC1-BM632w-100001/tasks?connection_request' \
-X POST \
--data '{"name":"addObject","objectName":"InternetGatewayDevice.LANDevice.1.Hosts.Host"}'


curl -i 'http://localhost:7557/devices/202BC1-BM632w-100001/tasks?connection_request' \
-X POST \
--data '{"name":"setParameterValues", "parameterValues": [
["InternetGatewayDevice.LANDevice.1.Hosts.Host.3.Active","true", "xsd:boolean"],
["InternetGatewayDevice.LANDevice.1.Hosts.Host.3.AddressSource","DHCP", "xsd:string"],
["InternetGatewayDevice.LANDevice.1.Hosts.Host.3.HostName","iphone-887bf88d22e66acc", "xsd:string"],
["InternetGatewayDevice.LANDevice.1.Hosts.Host.3.IPAddress","192.168.1.99", "xsd:string"],
["InternetGatewayDevice.LANDevice.1.Hosts.Host.3.Layer2Interface","InternetGatewayDevice.LANDevice.3.WLANConfiguration.1", "xsd:string"],
["InternetGatewayDevice.LANDevice.1.Hosts.Host.3.LeaseTimeRemaining","900922", "xsd:string"],
["InternetGatewayDevice.LANDevice.1.Hosts.Host.3.MACAddress","40:50:4A:8B:4A:40", "xsd:string"]
]}'
