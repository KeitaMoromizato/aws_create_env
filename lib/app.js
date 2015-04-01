var Promise = require('bluebird');
var AWS = require('aws-sdk');

var Beanstalk = new AWS.ElasticBeanstalk({apiVersion: '2010-12-01'});
var IAM = new AWS.IAM({apiVersion: '2010-05-08'});
var ELB = new AWS.ELB({apiVersion: '2012-06-01'});
var EC2 = new AWS.EC2({apiVersion: '2014-10-01'});

module.exports = {
  create: function(params, success, error) {

    var envName = params.envName;
    var appName = process.env.AWS_EB_APPLICATION_NAME;
    var templateName = process.env.AWS_EB_TEMPLATE_NAME;

    if (!envName) {
      return error("yout must add option, --environment [environment_name]")
    }
    else if (!appName) {
      return error("you must set env AWS_EB_APPLICATION_NAME")
    }
    else if (!templateName) {
      return error("you must set env AWS_EB_TEMPLATE_NAME")
    }

    var elbName;
    createEB(appName, envName, templateName).then(function(result) {
      return waitEBReady(appName, envName);
    }).then(function(result) {
      return getElbName(envName);
    }).then(function(result) {
      elbName = result;
      return setupElb(elbName);
    }).then(function(result) {
      return setupEC2SecurityGroup(envName, elbName);
    }).then(function(result) {
      success();
    }).catch(function(err) {
      error(err);
    });
  }
};

var createEB = function(appName, envName, templateName) {
  return new Promise(function(resolve, reject) {

    // create ElasticBeanstalk Environment
    Beanstalk.createEnvironment({
      ApplicationName: appName,
      EnvironmentName: envName,
      TemplateName: templateName
    }, function(error, data) {
      if (error) {
        return reject(error);
      }

      resolve({});
    });
  });
};

var waitEBReady = function(appName, envName) {
  return new Promise(function(resolve, reject) {

    // Wait Envionment setup...
    setTimeout(function waitReady() {
      Beanstalk.describeEnvironments({
        ApplicationName: appName,
        EnvironmentNames: [envName],
        IncludeDeleted: false
      }, function(error, data) {
        // TODO DBG Code
        console.log("wait...");

        if (error) {
          return reject(error);
        }
        else if (data.Environments[0].Status === 'Ready') {
          resolve({});
        }
        else {
          setTimeout(waitReady, 5000);
        }
      });
    }, 20000);
  });
};

var getElbName = function(envName) {
  return new Promise(function(resolve, reject) {
    Beanstalk.describeEnvironmentResources({EnvironmentName: envName}, function(error, data) {
      if (error) {
        return reject(error);
      }
      var elbName = data.EnvironmentResources.LoadBalancers[0].Name;

      resolve({elbName: elbName});
    });
  });
};

var setupElb = function(elbName) {
  return new Promise(function(resolve, reject) {
    IAM.getServerCertificate({
      ServerCertificateName: process.env.AWS_IAM_CERT_NAME
    }, function(error, data) {
      if (error) {
        return reject(error);
      }

      var ssl = data.ServerCertificate.ServerCertificateMetadata.Arn;

      Promise.all([
        setupElbListener(elbName, ssl),
        setupElbSecurityGroup(elbName)
      ]).then(function(result) {
        resolve({});
      }).catch(function(error) {
        reject(error);
      });
    });
  });
};

var setupElbListener = function(elbName, ssl) {
  var Listeners = [{
    Protocol: 'HTTPS',
    LoadBalancerPort: 443,
    InstanceProtocol: 'HTTP',
    InstancePort: 80,
    SSLCertificateId: ssl
  },
  {
    Protocol: 'HTTP',
    LoadBalancerPort: 80,
    InstanceProtocol: 'HTTP',
    InstancePort: 12345
  }];

  return new Promise(function(resolve, reject) {
    ELB.deleteLoadBalancerListeners({
      LoadBalancerName: elbName,
      LoadBalancerPorts: [80]
    }, function(error, data) {
      if (error) {
        return reject(error);
      }

      ELB.createLoadBalancerListeners({
        LoadBalancerName: elbName,
        Listeners: listeners
      }, function(error, data) {
        if (error) {
          return reject(error);
        }

        resolve({});
      });
    });
  });
};

var setupElbSecurityGroup = function(elbName) {
  var permissions = [{
    IpProtocol: 'tcp',
    FromPort: 3000,
    ToPort: 3000,
    IpRanges: [{CidrIp: '0.0.0.0/0'}]
  }];

  return new Promise(function(resolve, reject) {
    ELB.describeLoadBalancers({
      LoadBalancerNames: [elbName]
    }, function(error, data) {
      if (error) {
        return reject(error);
      }

      var sgId = data.LoadBalancerDescriptions[0].SecurityGroups[0];
      EC2.authorizeSecurityGroupIngress({
        GroupId: sgId,
        IpPermissions: permissions
      }, function(error, data) {
        if (error) {
          return reject(error);
        }

        resolve({});
      });
    });
  });
};

var setupEC2SecurityGroup = function(envName, elbName) {
  var permission =
  [{
    IpProtocol: 'tcp',
    FromPort: 11111,
    ToPort: 11111,
    UserIdGroupPairs: [{GroupId: sourceId}]
  },
  {
    IpProtocol: 'tcp',
    FromPort: 12345,
    ToPort: 12345,
    UserIdGroupPairs: [{GroupId: sourceId}]
  }];

  return new Promise(function(resolve, reject) {
    ELB.describeLoadBalancers({
      LoadBalancerNames: [elbName]
    }, function(error, data) {
      if (error) {
        return reject(error);
      }

      var sgId = data.LoadBalancerDescriptions[0].SecurityGroups[0];

      EC2.describeSecurityGroups({
        filters: [{Name: 'tag:Name', Values: [envName]}]
      }, function(error, data) {
        if (error) {
          return reject(error);
        }

        var ec2SgId = data.SecurityGroups[0].GroupId;
        EC2.authorizeSecurityGroupIngress({
          GroupId: ec2SgId,
          IpPermissions: permissions
        }, function(error, data) {
          if (error) {
            return reject(error);
          }

          resolve({});
        });
      });
    });
  });
};
