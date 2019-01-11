
let _ = require('lodash');
let Promise = require('promise')

let Accessory = require('./accessory');
let Activity = require('./activity');
let ActivityService = require('./activity-service');
let Service = require('./service');

function HarmonyHubAccessory(log, harmonyHub, accessory) {
	let self = this;
	self.log = log;
	self.harmonyHub = harmonyHub
    self.services = []
    self.isRegistered = false

    self.accessory = accessory || new Accessory(log, harmonyHub.id(), harmonyHub.name(), true)
    
	self.log.debug('{HarmonyHubAccessory} <' + self.id() + '> <' + self.name() + '>')

    if (self.harmonyHub) {
        self.setHarmonyHub(self.harmonyHub)
    }
}

HarmonyHubAccessory.fromAccessory = function(log, accessory) {
    log.debug('{HarmonyHubAccessory} fromAccessory')
    var accessory = new HarmonyHubAccessory(log, null, accessory)
    accessory.isRegistered = true
    return accessory
}

HarmonyHubAccessory.prototype.id = function() {
    return this.accessory.id()
}

HarmonyHubAccessory.prototype.name = function() {
    return this.accessory.name()
}

HarmonyHubAccessory.prototype.platformAccessory = function() {
    return this.accessory.accessory;
}

HarmonyHubAccessory.prototype.addActivity = function(activity) {
    this.log.info('{HarmonyHubAccessory} addActivity <' + activity.name() + '>')
    return this.accessory.addService(ActivityService(this.log), activity)
}

HarmonyHubAccessory.prototype.updateStates = function() {
    let self = this;
    if (!self.services) return;

    self.log.debug('{HarmonyHubAccessory} update states for <' + self.services.length + '> services')

    return self.harmonyHub.getActiveActivityId()
        .then(function(activityId) {
            _.each(self.services, function(service) {
                service.set(service.id() == activityId)
            })
        })
        .catch(function(err) {
            self.log.error('{HarmonyHubAccessory} updateStates:', err);
            throw err;
        })
}

HarmonyHubAccessory.prototype.handleStateChanges = function() {
    let self = this;
    if (!self.services) return;

    self.log.debug('{HarmonyHubAccessory} handle state changes for <' + self.services.length + '> services')

    _.each(self.services, function(service) {
        self.handleStateChange(service)
    })
}

HarmonyHubAccessory.prototype.handleStateChange = function(service) {
    let self = this
    service.onSetAndGet(
        function(on, activityId, callback) {
            self.harmonyHub
                .setActivityWithId(on, activityId)
                .then(function() {
                    self.log.debug('{HarmonyHubAccessory} done <' + activityId + '> <' + on + '>')
                    callback(null, on)
                })
        }, function(activityId, callback) {
            self.harmonyHub
                .isActivityIdActive(activityId)
                .then(function(on) {
                    callback(null, on)
                })
        }
    )
}

HarmonyHubAccessory.prototype.loadServices = function() {
    let self = this;
    return self.accessory
        .getServices()
        .then(function(services) {
            return _.filter(services, ActivityService.isInstance)
        })
        .then(function(services) {
            return _.map(services, function(service) {
                return new Service(self.log, service)
            })
        })
        .then(function(services) {
            self.log.debug('{HarmonyHubAccessory} found <' + services.length + '> services')
            return services
        })
        .catch(function(err) {
            self.log.error('{HarmonyHubAccessory} loadActivityAccessories:', err);
            throw err;
        })
}

HarmonyHubAccessory.prototype.loadActivities = function() {
    let self = this;
    return Promise.all([
            self.loadServices(),
            self.harmonyHub.getActivities()
        ])
        .then(function(res) {
            let oldServices = res[0]
            return Promise.resolve(res[1])
                .then(function(activities) {
                    return _.differenceWith(activities, oldServices, function(activity, service) {
                        return activity.id() == service.id()
                    })
                })
                .then(function(activities) {
                    if (activities.length > 0) {
                        self.log.info('{HarmonyHubAccessory} adding <' + activities.length + '> activities')
                    }
                    return _.map(activities, function(activity) {
                        return self.addActivity(activity)
                    })
                })
                .then(function(newServices) {
                    return _.concat(oldServices, newServices)
                })
        })
        .then(function(services) {
            self.services = services
            self.updateStates()
            self.handleStateChanges()
        })
        .catch(function(err) {
            self.log.error('{HarmonyHubAccessory} loadActivities:', err);
            throw err;
        })
}

HarmonyHubAccessory.prototype.setHarmonyHub = function(harmonyHub) {
    let self = this;
    self.harmonyHub = harmonyHub
    self.harmonyHub.on('stateChanged', function(_state) {
        let state = new HarmonyState(_state)
        if (state.updateNeeded()) {
            self.log.debug('{HarmonyHubAccessory} stateChanged: <' + state.state() + '>')
            self.updateStates()
        } else {
            self.log.debug('{HarmonyHubAccessory} stateChanged: <' + state.state() + '> (Ignore)')
        }
    })
    return self.loadActivities()
}

HarmonyHubAccessory.prototype.invalidate = function() {
    if (!this.harmonyHub) {
        return
    }
    this.log.debug('{HarmonyHubAccessory} invalidate <' + this.name() + '>')
    this.harmonyHub.invalidate()
}

module.exports = HarmonyHubAccessory;

// TODO(materik):
// * lock harmonyhub while turningOn/turningOff. see harmonyhub.busy
function HarmonyState(state) {
    this._state = state;
}

HarmonyState.turningOn = 'turningOn';
HarmonyState.isOn = 'isOn';
HarmonyState.turningOff = 'turningOff';
HarmonyState.isOff = 'isOff';
HarmonyState.unknown = 'unknown';

HarmonyState.prototype.updateNeeded = function() {
    return this.isOn() || this.isOff();
}

HarmonyState.prototype.state = function() {
    switch (this._state.activityStatus) {
    case 0: return this.isRunningActivity() ? HarmonyState.turningOff : HarmonyState.isOff;
    case 1: return HarmonyState.turningOn;
    case 2: return this.isRunningActivity() ? HarmonyState.isOn : HarmonyState.turningOn;
    case 3: return HarmonyState.turningOff;
    default: return HarmonyState.unknown
    }
}

HarmonyState.prototype.isOn = function() {
    return this.state() === HarmonyState.isOn;
}

HarmonyState.prototype.isOff = function() {
    return this.state() === HarmonyState.isOff;
}

HarmonyState.prototype.isRunningActivity = function() {
    return this._state.runningActivityList != '';
}
