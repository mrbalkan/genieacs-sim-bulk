#Start increasing cpu utilization from 1-30 to 85-100
curl -i 'http://localhost:7557/devices/202BC1-BM632w-100001/tasks?connection_request' \
-X POST \
--data '{"name":"setParameterValues", "parameterValues": [["InternetGatewayDevice.BulkData.Profile.1.Parameter.5.ValueFunction", "v.randomVal(85,100)", "xsd:string"]]}'
echo "\n"
