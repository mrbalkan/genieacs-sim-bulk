#Start increasing the errors sent kpi.
curl -i 'http://localhost:7557/devices/202BC1-BM632w-100000/tasks?connection_request' \
-X POST \
--data '{"name":"setParameterValues", "parameterValues": [["InternetGatewayDevice.BulkData.Profile.1.Parameter.3.ValueFunction", "v.increasingVal(<lastval>,v.randomVal(100,200))", "xsd:string"]]}'
