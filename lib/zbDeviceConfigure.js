'use strict';

const zigbeeHerdsmanConverters = require('zigbee-herdsman-converters');
const BaseExtension = require('./zbBaseExtension');

const forcedConfigureOnEachStart = [
    zigbeeHerdsmanConverters.devices.find((d) => d.model === 'V3-BTZB'),
    zigbeeHerdsmanConverters.devices.find((d) => d.model === '014G2461'),
    zigbeeHerdsmanConverters.devices.find((d) => d.model === 'SPZB0001'),
    zigbeeHerdsmanConverters.devices.find((d) => d.model === 'ZK03840')
];



class DeviceConfigure extends BaseExtension {
    constructor(zigbee, options) {
        super(zigbee, options);

        this.configuring = new Set();
        this.attempts = {};
        this.name = "DeviceConfigure";
    }

    setOptions(options) {
        if (typeof(options) != 'object') return false;
        return true;
    }

    shouldConfigure(device, mappedDevice) {
        if (!device || !mappedDevice) {
            return false;
        }
        if (!mappedDevice || !mappedDevice.configure) {
            return false;
        }
        if (device.meta.hasOwnProperty('configured') &&
            zigbeeHerdsmanConverters.getConfigureKey(mappedDevice)) {
            return false;
        }
        if (device.interviewing === true) {
            return false;
        }

        return true;
    }

    async onZigbeeStarted() {
        try {
            this.coordinatorEndpoint = await this.zigbee.getDevicesByType('Coordinator')[0].endpoints[0];

            for (const device of await this.zigbee.getClients()) {
                const mappedDevice = zigbeeHerdsmanConverters.findByDevice(device);

                if (forcedConfigureOnEachStart.find((d) => d && d.hasOwnProperty('zigbeeModel') && d.zigbeeModel.includes(device.modelID))) {
                    this.debug(`DeviceConfigure ${device.ieeeAddr} ${device.modelID} forced by adapter config`);
                    device.meta.configured = -1; // Force a reconfigure for this device
                }
                if (this.shouldConfigure(device, mappedDevice)) {
                    this.debug(`DeviceConfigure ${device.ieeeAddr} ${device.modelID} needed`);
                    await this.configure(device, mappedDevice);
                } else {
                    this.debug(`DeviceConfigure ${device.ieeeAddr} ${device.modelID} not needed`);
                }
            }
        } catch (error) {
            this.sendError(error);
            this.error(
                `Failed to DeviceConfigure.onZigbeeStarted (${error.stack})`,
            );
        }
    }

    onZigbeeEvent(data, mappedDevice) {
        try {
            const device = data.device;
            if (this.shouldConfigure(device, mappedDevice)) {
                this.configure(device, mappedDevice);
            }
        } catch (error) {
            this.sendError(error);
            this.error(
                `Failed to DeviceConfigure.onZigbeeEvent (${error.stack})`,
            );
        }
    }

    onDeviceRemove(device){
        try {
            if (this.configuring.has(device.ieeeAddr)) {
                this.configuring.delete(device.ieeeAddr);
            }

            if (this.attempts.hasOwnProperty(device.ieeeAddr)) {
                delete this.attempts[device.ieeeAddr];
            }
        } catch (error) {
            this.sendError(error);
            this.error(
                `Failed to DeviceConfigure.onDeviceRemove (${error.stack})`,
            );
        }
    }

    onDeviceLeave(data, entity){
        if (entity) {
            this.onDeviceRemove(entity.device);
        } else {
            this.onDeviceRemove(data);
        }
    }

    async configure(device, mappedDevice) {
        try {
            if (this.configuring.has(device.ieeeAddr) || this.attempts[device.ieeeAddr] >= 5) {
                return false;
            }

            this.configuring.add(device.ieeeAddr);

            if (!this.attempts.hasOwnProperty(device.ieeeAddr)) {
                this.attempts[device.ieeeAddr] = 0;
            }
            try {
                await this.doConfigure(device, mappedDevice);
            } catch (error) {
                this.sendError(error);
                this.warn(
                    `DeviceConfigure failed ${device.ieeeAddr} ${device.modelID}, ` +
                    `attempt ${this.attempts[device.ieeeAddr] + 1} (${error.stack})`,
                );
                this.attempts[device.ieeeAddr]++;
            }
            this.configuring.delete(device.ieeeAddr);
        } catch (error) {
            this.sendError(error);
            this.error(
                `Failed to DeviceConfigure.configure ${device.ieeeAddr} ${device.modelID} (${error.stack})`,
            );
        }
    }

    async doConfigure(device, mappedDevice) {
        this.info(`Configuring ${device.ieeeAddr} ${device.modelID}`);
        const coordinatorEndpoint = await this.zigbee.getDevicesByType('Coordinator')[0].endpoints[0];
        await mappedDevice.configure(device, coordinatorEndpoint);
        device.meta.configured = zigbeeHerdsmanConverters.getConfigureKey(mappedDevice);
        device.save();
        this.info(`DeviceConfigure successful ${device.ieeeAddr} ${device.modelID}`);
    }
}

module.exports = DeviceConfigure;
