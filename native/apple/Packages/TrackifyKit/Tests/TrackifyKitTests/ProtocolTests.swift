import XCTest
@testable import TrackifyKit

final class SSEAndChatTests: XCTestCase {
    func testSSEParserChunked() {
        var p = SSEParser()
        var out: [String] = []
        out += p.feed(Data("data: {\"type\":\"start\"}\n\nda".utf8))
        out += p.feed(Data("ta: {\"type\":\"text-start\",\"id\":\"t1\"}\r\n\r\n: comment\n\n".utf8))
        out += p.feed(Data("data: [DONE]\n\n".utf8))
        XCTAssertEqual(out, ["{\"type\":\"start\"}", "{\"type\":\"text-start\",\"id\":\"t1\"}", "[DONE]"])
    }

    func testReducerTextAndTools() {
        var r = ChatStreamReducer(messages: [ChatMessage(id: "u1", role: "user", parts: [.text(id: nil, text: "hi")])])
        let chunks = [
            #"{"type":"start","messageId":"m1"}"#,
            #"{"type":"start-step"}"#,
            #"{"type":"text-start","id":"a"}"#,
            #"{"type":"text-delta","id":"a","delta":"Hello "}"#,
            #"{"type":"text-delta","id":"a","delta":"there"}"#,
            #"{"type":"text-end","id":"a"}"#,
            #"{"type":"tool-input-start","toolCallId":"c1","toolName":"listTasks"}"#,
            #"{"type":"tool-input-available","toolCallId":"c1","toolName":"listTasks","input":{}}"#,
            #"{"type":"tool-output-available","toolCallId":"c1","output":[{"id":"x"}]}"#,
            #"{"type":"tool-input-available","toolCallId":"c2","toolName":"createTask","input":{"name":"New"}}"#,
            #"{"type":"finish-step"}"#,
            #"{"type":"finish"}"#,
            "[DONE]",
        ]
        for c in chunks { r.apply(c) }
        XCTAssertTrue(r.finished)
        XCTAssertEqual(r.messages.count, 2)
        let a = r.messages[1]
        XCTAssertEqual(a.id, "m1")
        XCTAssertEqual(a.text, "Hello there")
        guard case .tool(let t1) = a.parts[1], case .tool(let t2) = a.parts[2] else { return XCTFail("tools") }
        XCTAssertEqual(t1.state, "output-available")
        XCTAssertEqual(t2.state, "input-available")
        XCTAssertEqual(t2.input?["name"]?.stringValue, "New")
        // Continuation appends to the same assistant message.
        var r2 = ChatStreamReducer(messages: r.messages)
        r2.apply(#"{"type":"start","messageId":"m2"}"#)
        r2.apply(#"{"type":"text-start","id":"b"}"#)
        r2.apply(#"{"type":"text-delta","id":"b","delta":"Done"}"#)
        XCTAssertEqual(r2.messages.count, 2)
        XCTAssertEqual(r2.messages[1].text, "Hello thereDone")
        // Encoding keeps tool parts.
        let json = r.messages[1].json
        XCTAssertEqual(json["parts"]?.arrayValue?.count, 3)
        XCTAssertEqual(json["parts"]?.arrayValue?[2]["type"]?.stringValue, "tool-createTask")
    }

    func testToolDescriptions() {
        XCTAssertEqual(ChatTools.description("createTask", args: .object(["name": .string("X")])), "Create task \"X\"")
        XCTAssertEqual(ChatTools.description("setTaskGroupMembership", args: .object(["groupId": .null])), "Remove task from its group")
        XCTAssertEqual(ChatTools.description("setTaskGroupMembership", args: .object(["groupId": .string("g")])), "Assign task to group")
        let d = ChatTools.description("createEvent", args: .object(["taskName": .string("Swift"), "from": .string("2026-09-25T14:00:00Z"),
                                                                     "to": .string("2026-09-25T16:00:00Z")]), timeZone: TimeZone(identifier: "UTC")!)
        XCTAssertEqual(d, "Log time entry to \"Swift\" from Fri, Sep 25, 2:00 PM to Fri, Sep 25, 4:00 PM")
        XCTAssertEqual(ChatTools.argsSummary(.object(["taskId": .string("x"), "limit": .number(5)])), "limit: 5")
    }

    func testStoredMessage() throws {
        let json = #"[{"id":"1","conversationId":"c","role":"assistant","content":"x","parts":[{"type":"text","text":"Hi"},{"type":"tool-listTasks","toolCallId":"t","state":"result","input":{},"output":{"ok":true}}],"createdAt":"2026-09-26T10:00:00.000Z"}]"#
        let rows = try TrackifyJSON.decoder().decode([StoredChatMessage].self, from: Data(json.utf8))
        let m = rows[0].message
        XCTAssertEqual(m.parts.count, 2)
        guard case .tool(let t) = m.parts[1] else { return XCTFail() }
        XCTAssertTrue(t.hasResult)
    }
}

final class SocketFrameTests: XCTestCase {
    func testParse() {
        XCTAssertEqual(SocketFrame.parse(#"0{"sid":"abc","upgrades":[],"pingInterval":25000,"pingTimeout":20000}"#),
                       .open(sid: "abc", pingInterval: 25000, pingTimeout: 20000))
        XCTAssertEqual(SocketFrame.parse("2"), .ping)
        XCTAssertEqual(SocketFrame.parse("40"), .connect)
        XCTAssertEqual(SocketFrame.parse(#"40{"sid":"x"}"#), .connect)
        XCTAssertEqual(SocketFrame.parse("41"), .disconnect)
        XCTAssertEqual(SocketFrame.parse(#"42["timer:started",{"taskId":"t","startTime":1790416800000}]"#),
                       .event(name: "timer:started", args: [.object(["taskId": .string("t"), "startTime": .number(1790416800000)])]))
        XCTAssertEqual(SocketFrame.parse(#"42["presence:changed"]"#), .event(name: "presence:changed", args: []))
        XCTAssertEqual(SocketFrame.parse(#"4212["x",1]"#), .event(name: "x", args: [.number(1)]))
        XCTAssertEqual(SocketFrame.parse(#"44{"message":"nope"}"#), .connectError("nope"))
        XCTAssertEqual(SocketFrame.encodeEvent("authenticate", .object(["token": .string("abc")])), #"42["authenticate",{"token":"abc"}]"#)
        XCTAssertEqual(SocketIOClient.socketURL(for: URL(string: "https://x.dev")!)?.absoluteString, "wss://x.dev/socket.io/?EIO=4&transport=websocket")
    }

    func testMissingRoute() {
        let html = APIError.classify(status: 404, data: Data("<!DOCTYPE html><html>".utf8))
        XCTAssertTrue(TimerEngine.isMissingTimerRoute(html))
        let real = APIError.classify(status: 404, data: Data(#"{"error":"Task not found"}"#.utf8))
        XCTAssertFalse(TimerEngine.isMissingTimerRoute(real))
        XCTAssertEqual(real.message, "Task not found")
        let odd = APIError.classify(status: 404, data: Data(#"{"message":"x"}"#.utf8))
        XCTAssertTrue(TimerEngine.isMissingTimerRoute(odd))
        XCTAssertEqual(APIError.classify(status: 503, data: Data()).kind, .retryable)
        XCTAssertEqual(APIError.classify(status: 429, data: Data()).kind, .retryable)
        XCTAssertEqual(APIError.classify(status: 409, data: Data()).kind, .client)
        XCTAssertEqual(APIError.classify(status: 401, data: Data()).kind, .unauthorized)
    }
}
