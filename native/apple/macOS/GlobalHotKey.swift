import AppKit
import Carbon.HIToolbox

/// System-wide hotkey via Carbon `RegisterEventHotKey` (works without Accessibility permission).
final class GlobalHotKey {
    private var ref: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private let action: () -> Void
    private static var registry: [UInt32: GlobalHotKey] = [:]
    private static var nextId: UInt32 = 1
    private let hotKeyId: UInt32

    init?(keyCode: UInt32, modifiers: NSEvent.ModifierFlags, action: @escaping () -> Void) {
        self.action = action
        hotKeyId = Self.nextId
        Self.nextId += 1
        var carbonMods: UInt32 = 0
        if modifiers.contains(.command) { carbonMods |= UInt32(cmdKey) }
        if modifiers.contains(.option) { carbonMods |= UInt32(optionKey) }
        if modifiers.contains(.control) { carbonMods |= UInt32(controlKey) }
        if modifiers.contains(.shift) { carbonMods |= UInt32(shiftKey) }

        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let status = InstallEventHandler(GetApplicationEventTarget(), { _, event, _ -> OSStatus in
            var hk = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                              MemoryLayout<EventHotKeyID>.size, nil, &hk)
            if let target = GlobalHotKey.registry[hk.id] {
                DispatchQueue.main.async { target.action() }
            }
            return noErr
        }, 1, &spec, nil, &handler)
        guard status == noErr else { return nil }

        let id = EventHotKeyID(signature: OSType(0x5452_4B59) /* 'TRKY' */, id: hotKeyId)
        let reg = RegisterEventHotKey(keyCode, carbonMods, id, GetApplicationEventTarget(), 0, &ref)
        guard reg == noErr else { return nil }
        Self.registry[hotKeyId] = self
    }

    deinit {
        if let ref { UnregisterEventHotKey(ref) }
        if let handler { RemoveEventHandler(handler) }
        Self.registry[hotKeyId] = nil
    }
}
