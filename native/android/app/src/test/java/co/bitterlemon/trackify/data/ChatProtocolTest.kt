package co.bitterlemon.trackify.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatProtocolTest {
    @Test fun assemblesTextAndTools() {
        var m = ChatMessage("m", "assistant", emptyList())
        listOf(
            """{"type":"start","messageId":"x"}""",
            """{"type":"start-step"}""",
            """{"type":"tool-input-start","toolCallId":"t1","toolName":"listTasks"}""",
            """{"type":"tool-input-available","toolCallId":"t1","toolName":"listTasks","input":{}}""",
            """{"type":"tool-output-available","toolCallId":"t1","output":{"ok":1}}""",
            """{"type":"text-start","id":"a"}""",
            """{"type":"text-delta","id":"a","delta":"Hel"}""",
            """{"type":"text-delta","id":"a","delta":"lo"}""",
            """{"type":"tool-input-available","toolCallId":"t2","toolName":"createTask","input":{"name":"X"}}""",
            """{"type":"finish"}""",
        ).forEach { m = ChatProtocol.apply(m, ChatProtocol.parseChunk(it)) }
        val tools = m.parts.filterIsInstance<ChatPart.Tool>()
        assertEquals("output-available", tools[0].state)
        assertEquals("input-available", tools[1].state)
        assertEquals("Hello", m.parts.filterIsInstance<ChatPart.Text>().single().text)
    }

    @Test fun requestBodyUsesSubmitMessageAndOutputs() {
        val msgs = listOf(
            ChatMessage("u", "user", listOf(ChatPart.Text(null, "hi"))),
            ChatMessage("a", "assistant", listOf(ChatPart.Tool("createTask", "t", "result", null, null))),
        )
        val body = ChatProtocol.requestBody("c", msgs, "conv")
        assertTrue(body.contains("\"trigger\":\"submit-message\""))
        assertTrue(body.contains("\"conversationId\":\"conv\""))
        // A persisted "result" part with no stored output is dropped rather than sent broken.
        assertTrue(!body.contains("tool-createTask"))
    }
}
