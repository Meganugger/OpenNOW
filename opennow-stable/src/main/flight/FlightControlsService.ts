import { BrowserWindow } from "electron";
import HID from "node-hid";
import type {
  FlightDeviceInfo,
  FlightControlsState,
  FlightGamepadState,
  FlightProfile,
  FlightHidReportLayout,
} from "@shared/gfn";
import { IPC_CHANNELS } from "@shared/ipc";
import { FlightProfileManager } from "./FlightProfiles";
import { getDeviceConfig, makeVidPid } from "./FlightDeviceDefaults";
import {
  GAMEPAD_DPAD_UP,
  GAMEPAD_DPAD_DOWN,
  GAMEPAD_DPAD_LEFT,
  GAMEPAD_DPAD_RIGHT,
} from "./inputConstants";

const JOYSTICK_USAGE_PAGE = 0x01;
const JOYSTICK_USAGE = 0x04;
const GAMEPAD_USAGE = 0x05;
const HOTPLUG_SCAN_MS = 3000;

interface ParsedReport {
  axes: number[];
  buttons: boolean[];
  hatSwitch: number;
}

export class FlightControlsService {
  private device: HID.HID | null = null;
  private devicePath: string | null = null;
  private deviceVendorId = 0;
  private deviceProductId = 0;
  private deviceName = "";
  private enabled: boolean;
  private controllerSlot: number;
  private mainWindow: BrowserWindow | null = null;
  private hotplugTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private lastRawBytes: number[] = [];

  private reportLayout: FlightHidReportLayout | null = null;
  private profile: FlightProfile | null = null;
  private lastGamepadState: FlightGamepadState | null = null;

  readonly profileManager: FlightProfileManager;

  constructor(enabled: boolean, slot: number) {
    this.enabled = enabled;
    this.controllerSlot = Math.max(0, Math.min(3, slot));
    this.profileManager = new FlightProfileManager();
  }

  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  updateConfig(enabled: boolean, slot: number): void {
    const wasEnabled = this.enabled;
    this.enabled = enabled;
    this.controllerSlot = Math.max(0, Math.min(3, slot));

    if (!enabled && wasEnabled) {
      this.stopCapture();
      this.stopHotplugScan();
    }
    if (enabled && !wasEnabled) {
      this.startHotplugScan();
    }
  }

  initialize(): void {
    if (this.enabled) {
      this.startHotplugScan();
    }
    console.log(`[Flight] Service initialized (enabled=${this.enabled}, slot=${this.controllerSlot})`);
  }

  getDevices(): FlightDeviceInfo[] {
    try {
      const devices = HID.devices();
      return devices
        .filter((d) =>
          d.usagePage === JOYSTICK_USAGE_PAGE &&
          (d.usage === JOYSTICK_USAGE || d.usage === GAMEPAD_USAGE),
        )
        .map((d) => ({
          path: d.path ?? "",
          vendorId: d.vendorId ?? 0,
          productId: d.productId ?? 0,
          product: d.product ?? "Unknown Device",
          manufacturer: d.manufacturer ?? "",
          serialNumber: d.serialNumber ?? "",
          release: d.release ?? 0,
          interface: d.interface ?? -1,
          usagePage: d.usagePage ?? 0,
          usage: d.usage ?? 0,
        }))
        .filter((d) => d.path !== "");
    } catch (error) {
      console.warn("[Flight] Failed to enumerate HID devices:", error instanceof Error ? error.message : error);
      return [];
    }
  }

  startCapture(devicePath: string): boolean {
    if (!this.enabled) {
      console.log("[Flight] Cannot start capture: flight controls disabled");
      return false;
    }

    this.stopCapture();

    try {
      const allDevices = HID.devices();
      const deviceInfo = allDevices.find((d) => d.path === devicePath);
      if (!deviceInfo) {
        console.warn("[Flight] Device not found:", devicePath);
        return false;
      }

      const device = new HID.HID(devicePath);
      this.device = device;
      this.devicePath = devicePath;
      this.deviceVendorId = deviceInfo.vendorId ?? 0;
      this.deviceProductId = deviceInfo.productId ?? 0;
      this.deviceName = deviceInfo.product ?? "Unknown Device";

      const vidPid = makeVidPid(this.deviceVendorId, this.deviceProductId);
      const knownConfig = getDeviceConfig(this.deviceVendorId, this.deviceProductId);

      this.profile = this.profileManager.getOrCreateProfile(
        this.deviceVendorId,
        this.deviceProductId,
        this.deviceName,
      );

      this.reportLayout = this.profile.reportLayout ?? knownConfig?.layout ?? null;

      if (!this.reportLayout) {
        console.warn(`[Flight] No report layout for ${vidPid}, using auto-detect mode`);
      }

      console.log(`[Flight] Opened device: ${this.deviceName} (${vidPid}) at ${devicePath}`);
      if (knownConfig) {
        console.log(`[Flight] Known device: ${knownConfig.name}`);
      }

      device.on("data", (data: Buffer) => {
        this.onHidData(data);
      });

      device.on("error", (err: Error) => {
        console.warn("[Flight] HID device error:", err.message);
        this.handleDeviceDisconnect();
      });

      this.sendConnectedState(true);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn("[Flight] Failed to open device:", msg);
      this.device = null;
      this.devicePath = null;
      return false;
    }
  }

  stopCapture(): void {
    if (this.device) {
      try {
        this.device.close();
      } catch {
        // ignore
      }
      this.device = null;
    }

    if (this.devicePath) {
      this.sendConnectedState(false);
      this.devicePath = null;
      this.lastGamepadState = null;
      this.lastRawBytes = [];
      console.log("[Flight] Device capture stopped");
    }
  }

  isCapturing(): boolean {
    return this.device !== null;
  }

  dispose(): void {
    this.disposed = true;
    this.stopCapture();
    this.stopHotplugScan();
  }

  private startHotplugScan(): void {
    this.stopHotplugScan();
    this.hotplugTimer = setInterval(() => {
      if (this.disposed || !this.enabled) return;
      if (this.device) return;

      const devices = this.getDevices();
      if (devices.length > 0 && !this.device) {
        const firstDevice = devices[0]!;
        const vidPid = makeVidPid(firstDevice.vendorId, firstDevice.productId);
        const knownConfig = getDeviceConfig(firstDevice.vendorId, firstDevice.productId);
        console.log(
          `[Flight] Auto-detected device: ${knownConfig?.name ?? firstDevice.product} (${vidPid})`,
        );
      }
    }, HOTPLUG_SCAN_MS);
  }

  private stopHotplugScan(): void {
    if (this.hotplugTimer) {
      clearInterval(this.hotplugTimer);
      this.hotplugTimer = null;
    }
  }

  private handleDeviceDisconnect(): void {
    console.log("[Flight] Device disconnected");
    this.stopCapture();
  }

  private onHidData(data: Buffer): void {
    if (!this.reportLayout || !this.profile) {
      this.lastRawBytes = Array.from(data);
      this.sendRawState(data);
      return;
    }

    const parsed = this.parseReport(data, this.reportLayout);
    this.lastRawBytes = Array.from(data);

    const rawState: FlightControlsState = {
      connected: true,
      deviceName: this.deviceName,
      axes: parsed.axes,
      buttons: parsed.buttons,
      hatSwitch: parsed.hatSwitch,
      rawBytes: this.lastRawBytes,
    };
    this.emitStateUpdate(rawState);

    const gamepadState = this.mapToGamepad(parsed, this.profile);
    if (this.hasGamepadStateChanged(gamepadState)) {
      this.lastGamepadState = gamepadState;
      this.emitGamepadState(gamepadState);
    }
  }

  private parseReport(data: Buffer, layout: FlightHidReportLayout): ParsedReport {
    let offset = layout.skipReportId ? 1 : 0;
    const bytes = data;

    const axes: number[] = [];
    for (const axisDef of layout.axes) {
      const byteIdx = offset + axisDef.byteOffset;
      if (byteIdx + axisDef.byteCount > bytes.length) {
        axes.push(0);
        continue;
      }

      let rawValue: number;
      if (axisDef.byteCount === 2) {
        rawValue = axisDef.littleEndian
          ? bytes.readUInt16LE(byteIdx)
          : bytes.readUInt16BE(byteIdx);
        if (!axisDef.unsigned && rawValue > 32767) {
          rawValue = rawValue - 65536;
        }
      } else {
        rawValue = bytes.readUInt8(byteIdx);
        if (!axisDef.unsigned && rawValue > 127) {
          rawValue = rawValue - 256;
        }
      }

      const range = axisDef.rangeMax - axisDef.rangeMin;
      const normalized = range > 0 ? (rawValue - axisDef.rangeMin) / range : 0;
      axes.push(Math.max(0, Math.min(1, normalized)));
    }

    const buttons: boolean[] = [];
    for (const btnDef of layout.buttons) {
      const byteIdx = offset + btnDef.byteOffset;
      if (byteIdx >= bytes.length) {
        buttons.push(false);
        continue;
      }
      const byte = bytes.readUInt8(byteIdx);
      buttons.push((byte & (1 << btnDef.bitIndex)) !== 0);
    }

    let hatSwitch = -1;
    if (layout.hat) {
      const byteIdx = offset + layout.hat.byteOffset;
      if (byteIdx < bytes.length) {
        const byte = bytes.readUInt8(byteIdx);
        const hatValue = (byte >> layout.hat.bitOffset) & ((1 << layout.hat.bitCount) - 1);
        hatSwitch = hatValue === layout.hat.centerValue ? -1 : hatValue;
      }
    }

    return { axes, buttons, hatSwitch };
  }

  private mapToGamepad(parsed: ParsedReport, profile: FlightProfile): FlightGamepadState {
    const state: FlightGamepadState = {
      controllerId: this.controllerSlot,
      buttons: 0,
      leftTrigger: 0,
      rightTrigger: 0,
      leftStickX: 0,
      leftStickY: 0,
      rightStickX: 0,
      rightStickY: 0,
      connected: true,
    };

    for (const mapping of profile.axisMappings) {
      if (mapping.sourceIndex >= parsed.axes.length) continue;
      const rawNormalized = parsed.axes[mapping.sourceIndex]!;

      let value: number;
      if (mapping.target === "leftTrigger" || mapping.target === "rightTrigger") {
        value = mapping.inverted ? 1 - rawNormalized : rawNormalized;
        value = this.applyDeadzone(value, mapping.deadzone);
        value = this.applyCurve(value, mapping.sensitivity, mapping.curve);
        const clamped = Math.max(0, Math.min(255, Math.round(value * 255)));
        if (mapping.target === "leftTrigger") state.leftTrigger = clamped;
        else state.rightTrigger = clamped;
      } else {
        value = (rawNormalized * 2) - 1;
        if (mapping.inverted) value = -value;
        value = this.applyStickDeadzone(value, mapping.deadzone);
        value = this.applyStickCurve(value, mapping.sensitivity, mapping.curve);
        const clamped = Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
        switch (mapping.target) {
          case "leftStickX": state.leftStickX = clamped; break;
          case "leftStickY": state.leftStickY = clamped; break;
          case "rightStickX": state.rightStickX = clamped; break;
          case "rightStickY": state.rightStickY = clamped; break;
        }
      }
    }

    for (const mapping of profile.buttonMappings) {
      if (mapping.sourceIndex >= parsed.buttons.length) continue;
      if (parsed.buttons[mapping.sourceIndex]) {
        state.buttons |= mapping.targetButton;
      }
    }

    if (parsed.hatSwitch >= 0) {
      const hat = parsed.hatSwitch;
      if (hat === 0 || hat === 1 || hat === 7) state.buttons |= GAMEPAD_DPAD_UP;
      if (hat === 1 || hat === 2 || hat === 3) state.buttons |= GAMEPAD_DPAD_RIGHT;
      if (hat === 3 || hat === 4 || hat === 5) state.buttons |= GAMEPAD_DPAD_DOWN;
      if (hat === 5 || hat === 6 || hat === 7) state.buttons |= GAMEPAD_DPAD_LEFT;
    }

    return state;
  }

  private applyDeadzone(value: number, deadzone: number): number {
    if (value < deadzone) return 0;
    return (value - deadzone) / (1 - deadzone);
  }

  private applyStickDeadzone(value: number, deadzone: number): number {
    const abs = Math.abs(value);
    if (abs < deadzone) return 0;
    const sign = value >= 0 ? 1 : -1;
    return sign * ((abs - deadzone) / (1 - deadzone));
  }

  private applyCurve(value: number, sensitivity: number, curve: string): number {
    if (curve === "expo") {
      return Math.pow(value, 2) * sensitivity;
    }
    return value * sensitivity;
  }

  private applyStickCurve(value: number, sensitivity: number, curve: string): number {
    const sign = value >= 0 ? 1 : -1;
    const abs = Math.abs(value);
    if (curve === "expo") {
      return sign * Math.pow(abs, 2) * sensitivity;
    }
    return value * sensitivity;
  }

  private hasGamepadStateChanged(newState: FlightGamepadState): boolean {
    if (!this.lastGamepadState) return true;
    const prev = this.lastGamepadState;
    return (
      prev.buttons !== newState.buttons ||
      prev.leftTrigger !== newState.leftTrigger ||
      prev.rightTrigger !== newState.rightTrigger ||
      prev.leftStickX !== newState.leftStickX ||
      prev.leftStickY !== newState.leftStickY ||
      prev.rightStickX !== newState.rightStickX ||
      prev.rightStickY !== newState.rightStickY
    );
  }

  private sendConnectedState(connected: boolean): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const state: FlightControlsState = {
      connected,
      deviceName: this.deviceName,
      axes: [],
      buttons: [],
      hatSwitch: -1,
      rawBytes: [],
    };
    this.mainWindow.webContents.send(IPC_CHANNELS.FLIGHT_STATE_UPDATE, state);

    if (!connected) {
      const disconnectState: FlightGamepadState = {
        controllerId: this.controllerSlot,
        buttons: 0,
        leftTrigger: 0,
        rightTrigger: 0,
        leftStickX: 0,
        leftStickY: 0,
        rightStickX: 0,
        rightStickY: 0,
        connected: false,
      };
      this.mainWindow.webContents.send(IPC_CHANNELS.FLIGHT_GAMEPAD_STATE, disconnectState);
    }
  }

  private sendRawState(data: Buffer): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    const state: FlightControlsState = {
      connected: true,
      deviceName: this.deviceName,
      axes: [],
      buttons: [],
      hatSwitch: -1,
      rawBytes: Array.from(data),
    };
    this.mainWindow.webContents.send(IPC_CHANNELS.FLIGHT_STATE_UPDATE, state);
  }

  private emitStateUpdate(state: FlightControlsState): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send(IPC_CHANNELS.FLIGHT_STATE_UPDATE, state);
  }

  private emitGamepadState(state: FlightGamepadState): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send(IPC_CHANNELS.FLIGHT_GAMEPAD_STATE, state);
  }
}
