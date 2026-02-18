import { useState, useEffect, useCallback, useRef } from "react";
import type { JSX } from "react";
import { Joystick, RefreshCw, Save, Trash2, RotateCcw, Check } from "lucide-react";
import type {
  Settings,
  FlightDeviceInfo,
  FlightProfile,
  FlightControlsState,
  FlightAxisTarget,
  FlightSensitivityCurve,
} from "@shared/gfn";

interface FlightControlsPanelProps {
  settings: Settings;
  onSettingChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

const AXIS_TARGETS: { value: FlightAxisTarget; label: string }[] = [
  { value: "leftStickX", label: "Left Stick X (Roll)" },
  { value: "leftStickY", label: "Left Stick Y (Pitch)" },
  { value: "rightStickX", label: "Right Stick X (Yaw)" },
  { value: "rightStickY", label: "Right Stick Y" },
  { value: "leftTrigger", label: "Left Trigger" },
  { value: "rightTrigger", label: "Right Trigger (Throttle)" },
];

const CURVE_OPTIONS: { value: FlightSensitivityCurve; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "expo", label: "Exponential" },
];

const SLOT_OPTIONS = [
  { value: 0, label: "Slot 0" },
  { value: 1, label: "Slot 1" },
  { value: 2, label: "Slot 2" },
  { value: 3, label: "Slot 3" },
];

function makeVidPid(vendorId: number, productId: number): string {
  return `${vendorId.toString(16).toUpperCase().padStart(4, "0")}:${productId.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function FlightControlsPanel({ settings, onSettingChange }: FlightControlsPanelProps): JSX.Element {
  const [devices, setDevices] = useState<FlightDeviceInfo[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [capturing, setCapturing] = useState(false);
  const [liveState, setLiveState] = useState<FlightControlsState | null>(null);
  const [profile, setProfile] = useState<FlightProfile | null>(null);
  const [profiles, setProfiles] = useState<FlightProfile[]>([]);
  const [savedIndicator, setSavedIndicator] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const stateCleanupRef = useRef<(() => void) | null>(null);

  const scanDevices = useCallback(async () => {
    setIsScanning(true);
    try {
      const found = await window.openNow.flightGetDevices();
      setDevices(found);
      if (found.length > 0 && !selectedPath) {
        setSelectedPath(found[0]!.path);
      }
    } catch (error) {
      console.warn("[Flight UI] Failed to scan devices:", error);
    } finally {
      setIsScanning(false);
    }
  }, [selectedPath]);

  const loadProfiles = useCallback(async () => {
    try {
      const all = await window.openNow.flightGetAllProfiles();
      setProfiles(all);
    } catch (error) {
      console.warn("[Flight UI] Failed to load profiles:", error);
    }
  }, []);

  useEffect(() => {
    if (settings.flightControlsEnabled) {
      void scanDevices();
      void loadProfiles();
    }
  }, [settings.flightControlsEnabled, scanDevices, loadProfiles]);

  useEffect(() => {
    if (!settings.flightControlsEnabled) return;
    const cleanup = window.openNow.onFlightStateUpdate((state: FlightControlsState) => {
      setLiveState(state);
    });
    stateCleanupRef.current = cleanup;
    return () => {
      cleanup();
      stateCleanupRef.current = null;
    };
  }, [settings.flightControlsEnabled]);

  const handleStartCapture = useCallback(async () => {
    if (!selectedPath) return;
    try {
      const success = await window.openNow.flightStartCapture(selectedPath);
      setCapturing(success);
      if (success) {
        const device = devices.find((d) => d.path === selectedPath);
        if (device) {
          const vidPid = makeVidPid(device.vendorId, device.productId);
          const p = await window.openNow.flightGetProfile(vidPid);
          setProfile(p);
        }
      }
    } catch (error) {
      console.warn("[Flight UI] Failed to start capture:", error);
    }
  }, [selectedPath, devices]);

  const handleStopCapture = useCallback(async () => {
    try {
      await window.openNow.flightStopCapture();
      setCapturing(false);
      setLiveState(null);
    } catch (error) {
      console.warn("[Flight UI] Failed to stop capture:", error);
    }
  }, []);

  const handleSaveProfile = useCallback(async () => {
    if (!profile) return;
    try {
      await window.openNow.flightSetProfile(profile);
      setSavedIndicator(true);
      setTimeout(() => setSavedIndicator(false), 1500);
      void loadProfiles();
    } catch (error) {
      console.warn("[Flight UI] Failed to save profile:", error);
    }
  }, [profile, loadProfiles]);

  const handleResetProfile = useCallback(async () => {
    if (!profile) return;
    try {
      const reset = await window.openNow.flightResetProfile(profile.vidPid);
      if (reset) setProfile(reset);
      void loadProfiles();
    } catch (error) {
      console.warn("[Flight UI] Failed to reset profile:", error);
    }
  }, [profile, loadProfiles]);

  const handleDeleteProfile = useCallback(async (vidPid: string, gameId?: string) => {
    try {
      await window.openNow.flightDeleteProfile(vidPid, gameId);
      void loadProfiles();
    } catch (error) {
      console.warn("[Flight UI] Failed to delete profile:", error);
    }
  }, [loadProfiles]);

  const updateAxisMapping = useCallback((sourceIndex: number, field: string, value: unknown) => {
    if (!profile) return;
    const updated = { ...profile };
    updated.axisMappings = updated.axisMappings.map((m) => {
      if (m.sourceIndex !== sourceIndex) return m;
      return { ...m, [field]: value };
    });
    setProfile(updated);
  }, [profile]);

  const _selectedDevice = devices.find((d) => d.path === selectedPath);

  return (
    <div className="flight-controls-panel">
      <div className="settings-row">
        <label className="settings-label">Enable Flight Controls</label>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.flightControlsEnabled}
            onChange={(e) => onSettingChange("flightControlsEnabled", e.target.checked)}
          />
          <span className="settings-toggle-track" />
        </label>
      </div>

      {settings.flightControlsEnabled && (
        <>
          <div className="settings-row">
            <label className="settings-label">Controller Slot</label>
            <select
              className="settings-select"
              value={settings.flightControlsSlot}
              onChange={(e) => onSettingChange("flightControlsSlot", Number(e.target.value))}
            >
              {SLOT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="flight-device-section">
            <div className="flight-device-header">
              <h3>Detected Devices</h3>
              <button
                type="button"
                className="flight-btn flight-btn--small"
                onClick={() => void scanDevices()}
                disabled={isScanning}
                title="Rescan devices"
              >
                <RefreshCw size={14} className={isScanning ? "flight-spin" : ""} />
                Scan
              </button>
            </div>

            {devices.length === 0 ? (
              <div className="flight-empty">
                No flight controllers detected. Connect a device and click Scan.
              </div>
            ) : (
              <div className="flight-device-list">
                {devices.map((device) => (
                  <label
                    key={device.path}
                    className={`flight-device-item ${selectedPath === device.path ? "active" : ""}`}
                  >
                    <input
                      type="radio"
                      name="flight-device"
                      value={device.path}
                      checked={selectedPath === device.path}
                      onChange={() => setSelectedPath(device.path)}
                    />
                    <div className="flight-device-info">
                      <span className="flight-device-name">
                        {device.product || "Unknown Device"}
                      </span>
                      <span className="flight-device-meta">
                        {makeVidPid(device.vendorId, device.productId)}
                        {device.manufacturer ? ` · ${device.manufacturer}` : ""}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            )}

            <div className="flight-capture-controls">
              {!capturing ? (
                <button
                  type="button"
                  className="flight-btn flight-btn--primary"
                  onClick={() => void handleStartCapture()}
                  disabled={!selectedPath}
                >
                  <Joystick size={14} />
                  Start Capture
                </button>
              ) : (
                <button
                  type="button"
                  className="flight-btn flight-btn--danger"
                  onClick={() => void handleStopCapture()}
                >
                  Stop Capture
                </button>
              )}
            </div>
          </div>

          {capturing && liveState && (
            <div className="flight-tester">
              <h3>Live Input Tester</h3>
              <div className="flight-tester-status">
                <span className={`flight-status-dot ${liveState.connected ? "connected" : ""}`} />
                <span>{liveState.connected ? liveState.deviceName : "Disconnected"}</span>
              </div>

              {liveState.axes.length > 0 && (
                <div className="flight-axes-grid">
                  {liveState.axes.map((value, i) => (
                    <div key={i} className="flight-axis-bar">
                      <span className="flight-axis-label">Axis {i}</span>
                      <div className="flight-axis-track">
                        <div
                          className="flight-axis-fill"
                          style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
                        />
                      </div>
                      <span className="flight-axis-value">{(value * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              )}

              {liveState.buttons.length > 0 && (
                <div className="flight-buttons-grid">
                  {liveState.buttons.map((pressed, i) => (
                    <div key={i} className={`flight-button-indicator ${pressed ? "pressed" : ""}`}>
                      {i}
                    </div>
                  ))}
                </div>
              )}

              {liveState.hatSwitch >= 0 && (
                <div className="flight-hat-indicator">
                  Hat: {liveState.hatSwitch}
                </div>
              )}

              {liveState.rawBytes.length > 0 && (
                <details className="flight-raw-bytes">
                  <summary>Raw Bytes ({liveState.rawBytes.length})</summary>
                  <code className="flight-raw-bytes-data">
                    {liveState.rawBytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}
                  </code>
                </details>
              )}
            </div>
          )}

          {profile && (
            <div className="flight-mapping-section">
              <div className="flight-mapping-header">
                <h3>Axis Mapping — {profile.name}</h3>
                <div className="flight-mapping-actions">
                  <button
                    type="button"
                    className="flight-btn flight-btn--small"
                    onClick={() => void handleResetProfile()}
                    title="Reset to defaults"
                  >
                    <RotateCcw size={14} />
                    Reset
                  </button>
                  <button
                    type="button"
                    className="flight-btn flight-btn--small flight-btn--primary"
                    onClick={() => void handleSaveProfile()}
                  >
                    {savedIndicator ? <Check size={14} /> : <Save size={14} />}
                    {savedIndicator ? "Saved" : "Save"}
                  </button>
                </div>
              </div>

              <div className="flight-mappings-list">
                {profile.axisMappings.map((mapping) => (
                  <div key={mapping.sourceIndex} className="flight-mapping-row">
                    <div className="flight-mapping-source">
                      <span>Axis {mapping.sourceIndex}</span>
                    </div>
                    <div className="flight-mapping-fields">
                      <label className="flight-mapping-field">
                        <span>Target</span>
                        <select
                          className="settings-select"
                          value={mapping.target}
                          onChange={(e) => updateAxisMapping(mapping.sourceIndex, "target", e.target.value)}
                        >
                          {AXIS_TARGETS.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flight-mapping-field flight-mapping-field--checkbox">
                        <input
                          type="checkbox"
                          checked={mapping.inverted}
                          onChange={(e) => updateAxisMapping(mapping.sourceIndex, "inverted", e.target.checked)}
                        />
                        <span>Invert</span>
                      </label>
                      <label className="flight-mapping-field">
                        <span>Deadzone</span>
                        <input
                          type="range"
                          min="0"
                          max="0.5"
                          step="0.01"
                          value={mapping.deadzone}
                          onChange={(e) => updateAxisMapping(mapping.sourceIndex, "deadzone", parseFloat(e.target.value))}
                        />
                        <span className="flight-mapping-value">{(mapping.deadzone * 100).toFixed(0)}%</span>
                      </label>
                      <label className="flight-mapping-field">
                        <span>Sensitivity</span>
                        <input
                          type="range"
                          min="0.1"
                          max="3.0"
                          step="0.1"
                          value={mapping.sensitivity}
                          onChange={(e) => updateAxisMapping(mapping.sourceIndex, "sensitivity", parseFloat(e.target.value))}
                        />
                        <span className="flight-mapping-value">{mapping.sensitivity.toFixed(1)}</span>
                      </label>
                      <label className="flight-mapping-field">
                        <span>Curve</span>
                        <select
                          className="settings-select"
                          value={mapping.curve}
                          onChange={(e) => updateAxisMapping(mapping.sourceIndex, "curve", e.target.value)}
                        >
                          {CURVE_OPTIONS.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {profiles.length > 0 && (
            <div className="flight-profiles-section">
              <h3>Saved Profiles</h3>
              <div className="flight-profiles-list">
                {profiles.map((p) => (
                  <div key={`${p.vidPid}:${p.gameId ?? "global"}`} className="flight-profile-row">
                    <div className="flight-profile-info">
                      <span className="flight-profile-name">{p.name}</span>
                      <span className="flight-profile-meta">
                        {p.vidPid}
                        {p.gameId ? ` · Game: ${p.gameId}` : " · Global"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="flight-btn flight-btn--small flight-btn--danger"
                      onClick={() => void handleDeleteProfile(p.vidPid, p.gameId)}
                      title="Delete profile"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
