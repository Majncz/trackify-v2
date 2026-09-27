package co.bitterlemon.trackify.ui.chat

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.ChatMessage
import co.bitterlemon.trackify.data.ChatPart
import co.bitterlemon.trackify.data.Conversation
import co.bitterlemon.trackify.ui.components.BtnSize
import co.bitterlemon.trackify.ui.components.BtnVariant
import co.bitterlemon.trackify.ui.components.ConfirmDialog
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.theme.T
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private fun tabTitle(c: Conversation): String {
    val t = c.title ?: return "New chat"
    val words = t.split(" ")
    return if (words.size > 3) words.take(3).joinToString(" ") + "..." else t
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ChatScreen(onBack: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val vm: ChatVm = viewModel { ChatVm(graph) }
    var confirmDelete by remember { mutableStateOf<Conversation?>(null) }
    val listState = rememberLazyListState()
    val tabsState = rememberLazyListState()

    val lastLen = vm.messages.lastOrNull()?.parts?.sumOf { if (it is ChatPart.Text) it.text.length else 10 } ?: 0
    LaunchedEffect(vm.messages.size, lastLen, vm.streaming) {
        if (vm.messages.isNotEmpty()) listState.animateScrollToItem(listState.layoutInfo.totalItemsCount.coerceAtLeast(1) - 1)
    }
    LaunchedEffect(vm.conversations.size) { if (vm.conversations.isNotEmpty()) tabsState.scrollToItem(vm.conversations.size) }

    Column(Modifier.fillMaxSize().imePadding()) {
        co.bitterlemon.trackify.ui.components.ScreenBar("AI chat", onBack = onBack) {
            IconButton({ vm.newConversation() }) { Icon(Icons.Outlined.Add, "New conversation", tint = T.c.foreground) }
        }
        // Conversation tabs (oldest first, auto-scrolled to the end)
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            LazyRow(Modifier.weight(1f), state = tabsState, contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(vm.conversations, key = { it.id }) { c ->
                    val active = c.id == vm.currentId
                    Text(
                        tabTitle(c),
                        Modifier.clip(RoundedCornerShape(8.dp))
                            .background(if (active) T.c.primary else T.c.muted)
                            .combinedClickable(onClick = { vm.select(c.id) }, onLongClick = { confirmDelete = c }, onLongClickLabel = "Delete conversation")
                            .padding(horizontal = 12.dp, vertical = 7.dp),
                        fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1,
                        color = if (active) T.c.onPrimary else T.c.foreground,
                    )
                }
            }
        }
        HorizontalDivider(color = T.c.border)

        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            state = listState,
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (vm.messages.isEmpty() && vm.error == null && !vm.loadingMessages) {
                item(key = "empty") { EmptyChat { vm.send(it) } }
            }
            itemsIndexed(vm.messages, key = { i, m -> "${m.id}-$i" }) { _, m -> MessageBubble(m, vm) }
            if (vm.streaming && vm.messages.lastOrNull()?.let { it.role == "user" || it.parts.isEmpty() } == true) {
                item(key = "typing") { TypingBubble() }
            }
            vm.error?.let { e ->
                item(key = "error") {
                    Text(e, Modifier.widthIn(max = 720.dp).fillMaxWidth().clip(RoundedCornerShape(6.dp)).background(T.c.destructive.copy(alpha = 0.1f)).padding(horizontal = 12.dp, vertical = 8.dp), color = T.c.destructive, fontSize = 14.sp)
                }
            }
        }

        HorizontalDivider(color = T.c.border)
        Row(Modifier.fillMaxWidth().background(T.c.background).padding(12.dp), verticalAlignment = Alignment.Bottom) {
            BasicTextField(
                vm.input, { vm.input = it },
                enabled = !vm.streaming,
                textStyle = TextStyle(fontSize = 15.sp, color = T.c.foreground),
                cursorBrush = SolidColor(T.c.foreground),
                maxLines = 5,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { vm.send() }),
                modifier = Modifier.weight(1f).heightIn(min = 44.dp).alpha(if (vm.streaming) 0.5f else 1f)
                    .onPreviewKeyEvent { e ->
                        // Hardware Enter sends; Shift+Enter inserts a newline (web behaviour).
                        if (e.key == Key.Enter && e.type == KeyEventType.KeyDown && !e.isShiftPressed) { vm.send(); true } else false
                    },
                decorationBox = { inner ->
                    Box(
                        Modifier.clip(RoundedCornerShape(8.dp)).border(1.dp, T.c.border, RoundedCornerShape(8.dp)).background(T.c.background).padding(horizontal = 12.dp, vertical = 11.dp),
                    ) {
                        if (vm.input.isEmpty()) Text("Type a message...", color = T.c.mutedForeground, fontSize = 15.sp)
                        inner()
                    }
                },
            )
            Spacer(Modifier.width(8.dp))
            if (vm.streaming) {
                TButton(null, { vm.stop() }, variant = BtnVariant.Destructive, size = BtnSize.Icon, icon = Icons.Outlined.Stop, contentDescription = "Stop", modifier = Modifier.size(44.dp))
            } else {
                TButton(null, { vm.send() }, size = BtnSize.Icon, icon = Icons.AutoMirrored.Outlined.Send, contentDescription = "Send", enabled = vm.input.isNotBlank(), modifier = Modifier.size(44.dp))
            }
        }
    }

    confirmDelete?.let { c ->
        ConfirmDialog("Delete conversation?", "\"${tabTitle(c)}\" and its messages will be removed.", "Delete", onConfirm = { vm.delete(c.id) }, onDismiss = { confirmDelete = null })
    }
}

@Composable
private fun EmptyChat(onExample: (String) -> Unit) {
    Column(Modifier.widthIn(max = 448.dp).fillMaxWidth().padding(top = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Outlined.SmartToy, null, tint = T.c.mutedForeground, modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(16.dp))
        Text("How can I help?", fontSize = 18.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
        Spacer(Modifier.height(8.dp))
        Text("Try something like:", fontSize = 14.sp, color = T.c.mutedForeground)
        Spacer(Modifier.height(16.dp))
        listOf("What tasks do I have?", "How much did I work this week?", "Log 2 hours to my project yesterday").forEach { t ->
            Text(
                "\"$t\"",
                Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(8.dp)).background(T.c.muted).clickable(role = Role.Button) { onExample(t) }.padding(horizontal = 16.dp, vertical = 12.dp),
                fontSize = 14.sp, color = T.c.mutedForeground,
            )
        }
    }
}

@Composable
private fun TypingBubble() {
    Row(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
        val t = rememberInfiniteTransition(label = "typing")
        Row(Modifier.clip(RoundedCornerShape(8.dp)).background(T.c.muted).padding(horizontal = 14.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            repeat(3) { i ->
                val a by t.animateFloat(0.25f, 1f, infiniteRepeatable(tween(600, delayMillis = i * 150), RepeatMode.Reverse), label = "d$i")
                Box(Modifier.size(6.dp).alpha(a).clip(CircleShape).background(T.c.mutedForeground))
            }
        }
    }
}

@Composable
private fun MessageBubble(m: ChatMessage, vm: ChatVm) {
    Row(Modifier.widthIn(max = 720.dp).fillMaxWidth(), horizontalArrangement = if (m.role == "user") Arrangement.End else Arrangement.Start) {
        if (m.role == "user") {
            Text(
                m.parts.filterIsInstance<ChatPart.Text>().joinToString("") { it.text },
                Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(8.dp)).background(T.c.primary).padding(horizontal = 12.dp, vertical = 8.dp),
                color = T.c.onPrimary, fontSize = 14.sp, lineHeight = 20.sp,
            )
        } else {
            if (m.parts.none { it is ChatPart.Text && it.text.isNotBlank() || it is ChatPart.Tool }) return@Row
            Column(Modifier.fillMaxWidth(0.94f).clip(RoundedCornerShape(8.dp)).background(T.c.muted).padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                m.parts.forEach { p ->
                    when (p) {
                        is ChatPart.Text -> if (p.text.isNotBlank()) MarkdownText(p.text, T.c.foreground)
                        is ChatPart.Tool -> ToolPart(p, vm)
                        else -> Unit
                    }
                }
            }
        }
    }
}

@Composable
private fun ToolPart(p: ChatPart.Tool, vm: ChatVm) {
    val label = TOOL_DESCRIPTIONS[p.toolName] ?: p.toolName
    val approval = vm.approvals[p.toolCallId]
    val shape = RoundedCornerShape(8.dp)
    when {
        vm.needsApproval(p) -> Column(Modifier.fillMaxWidth().clip(shape).border(2.dp, T.c.amber.copy(alpha = 0.5f), shape).background(T.c.amber.copy(alpha = 0.1f)).padding(horizontal = 12.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.ErrorOutline, null, tint = T.c.amber, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(label, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
            }
            if (p.input != null && p.input.isNotEmpty()) {
                Text(ChatVm.describe(p.toolName, p.input), fontSize = 14.sp, color = T.c.foreground, modifier = Modifier.padding(start = 22.dp, top = 4.dp, bottom = 8.dp))
            }
            Row(Modifier.padding(start = 22.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                TButton("Approve", { vm.approve(p) }, size = BtnSize.Sm, icon = Icons.Outlined.Check, enabled = approval != Approval.Executing)
                TButton("Reject", { vm.reject(p) }, size = BtnSize.Sm, variant = BtnVariant.Outline, icon = Icons.Outlined.Close, enabled = approval != Approval.Executing)
            }
        }
        approval == Approval.Executing -> ToolLine(null, "Executing $label...", Color.Transparent, spinner = true)
        approval == Approval.Rejected -> ToolLine(Icons.Outlined.Close to T.c.red, "$label - Rejected", T.c.red.copy(alpha = 0.1f))
        else -> {
            val done = p.state == "output-available" || p.state == "result" || approval == Approval.Approved
            val out = p.output as? JsonObject
            val failed = out?.get("success")?.let { (it as? JsonPrimitive)?.content == "false" } == true || (out?.get("error") != null && out["error"] !is kotlinx.serialization.json.JsonNull)
            val err = if (failed) out?.get("error")?.let { (it as? JsonPrimitive)?.content ?: it.toString() } else null
            val args = if (p.input != null && p.input.isNotEmpty()) " (${ChatVm.formatArgs(p.input)})" else ""
            ToolLine(
                if (!done) null else if (failed) Icons.Outlined.Close to T.c.red else Icons.Outlined.Check to Color(0xFF16A34A),
                label + args, if (failed) T.c.red.copy(alpha = 0.1f) else T.c.card.copy(alpha = 0.5f),
                spinner = !done, error = err,
            )
        }
    }
}

@Composable
private fun ToolLine(icon: Pair<androidx.compose.ui.graphics.vector.ImageVector, Color>?, text: String, bg: Color, spinner: Boolean = false, error: String? = null) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).border(1.dp, T.c.border, RoundedCornerShape(6.dp)).background(bg).padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (spinner) CircularProgressIndicator(Modifier.size(14.dp), color = T.c.blue, strokeWidth = 2.dp)
        else if (icon != null) Icon(icon.first, null, tint = icon.second, modifier = Modifier.size(15.dp))
        Spacer(Modifier.width(6.dp))
        Text(
            androidx.compose.ui.text.buildAnnotatedString {
                append(text)
                if (error != null) {
                    pushStyle(androidx.compose.ui.text.SpanStyle(color = T.c.red)); append(" - $error"); pop()
                }
            },
            fontSize = 13.sp, color = T.c.mutedForeground, maxLines = 3, overflow = TextOverflow.Ellipsis,
        )
    }
}

@Suppress("unused")
private val unusedAlign = TextAlign.Center
