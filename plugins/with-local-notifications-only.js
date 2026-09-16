const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * This app schedules notifications locally and does not register for remote push.
 * Personal Team signing cannot provision the remote-push entitlement, so keep the
 * generated native project aligned with the product's actual notification scope.
 */
module.exports = function withLocalNotificationsOnly(config) {
  return withEntitlementsPlist(config, (configuredProject) => {
    delete configuredProject.modResults['aps-environment'];
    return configuredProject;
  });
};
