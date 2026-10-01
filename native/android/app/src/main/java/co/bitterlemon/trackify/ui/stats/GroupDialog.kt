package co.bitterlemon.trackify.ui.stats

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.Group
import co.bitterlemon.trackify.data.Task
import co.bitterlemon.trackify.ui.auth.friendlyError
import co.bitterlemon.trackify.ui.components.BadgeVariant
import co.bitterlemon.trackify.ui.components.BtnSize
import co.bitterlemon.trackify.ui.components.BtnVariant
import co.bitterlemon.trackify.ui.components.TBadge
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.TDialog
import co.bitterlemon.trackify.ui.components.TInput
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.Tabular
import co.bitterlemon.trackify.ui.theme.hexColor
import co.bitterlemon.trackify.util.Accents
import co.bitterlemon.trackify.util.Format
import kotlinx.coroutines.launch

/** Create / edit a task group (web Stats dialogs). [editing] null = create. */
@Composable
fun GroupDialog(editing: Group?, tasks: List<Task>, msInRange: Map<String, Long>, onDismiss: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    val create = editing == null
    var name by remember { mutableStateOf(editing?.name ?: "") }
    var auto by remember { mutableStateOf(editing != null && editing.color == null) }
    var color by remember { mutableStateOf(editing?.color ?: if (create) Accents.GROUP_COLOR_PRESETS.random() else Accents.groupAccentHex(editing!!.id)) }
    var filter by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(editing?.taskIds?.toSet() ?: emptySet()) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }

    fun allowed(t: Task) = t.taskGroup == null || (editing != null && t.taskGroup.id == editing.id)
    val sorted = remember(tasks, msInRange) { if (create) tasks.sortedByDescending { msInRange[it.id] ?: 0L } else tasks }
    val filtered = sorted.filter { filter.isBlank() || it.name.lowercase().contains(filter.trim().lowercase()) }
    val selectedMs = tasks.filter { it.id in selected }.sumOf { msInRange[it.id] ?: 0L }

    fun save() {
        if (name.isBlank()) return
        if (create && selected.isEmpty()) return
        if (!auto && !Accents.isValidHex(color)) {
            error = "Pick a preset color or switch to Auto."; return
        }
        saving = true; error = null
        scope.launch {
            try {
                if (create) graph.api.createGroup(name.trim(), selected.toList(), if (auto) null else color)
                else graph.api.updateGroup(editing!!.id, name.trim(), selected.toList(), if (auto) null else color)
                graph.repo.refreshGroups(); graph.repo.requestRefresh(0); onDismiss()
            } catch (e: Exception) {
                error = friendlyError(e, if (create) "Could not create group" else "Could not save group")
            }
            saving = false
        }
    }

    TDialog(
        if (create) "Create a group from tasks" else "Edit group", onDismiss, maxWidth = 576.dp, scrollable = false,
        footer = {
            Column(Modifier.fillMaxWidth()) {
                if (create) {
                    Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("${selected.size}", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular)
                        Text(" task${if (selected.size != 1) "s" else ""} selected", fontSize = 14.sp, color = T.c.mutedForeground, modifier = Modifier.weight(1f))
                        Text(Format.fmtMs(selectedMs), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular)
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                    TButton("Cancel", onDismiss, variant = BtnVariant.Outline)
                    TButton(
                        if (saving) "Saving…" else if (create) "Save group" else "Save", { save() },
                        enabled = !saving && name.isNotBlank() && (!create || selected.isNotEmpty()),
                    )
                }
            }
        },
    ) {
        if (create) error?.let { Text(it, color = T.c.destructive, fontSize = 14.sp); Spacer(Modifier.height(8.dp)) }
        TInput(name, { name = it.take(100) }, placeholder = "Group name", onIme = { save() })
        Spacer(Modifier.height(12.dp))
        Text("Group color", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TButton("Auto", { auto = true; if (!create) color = Accents.groupAccentHex(editing!!.id) }, size = BtnSize.Sm, variant = if (auto) BtnVariant.Secondary else BtnVariant.Outline)
            TButton("Custom", { auto = false }, size = BtnSize.Sm, variant = if (!auto) BtnVariant.Secondary else BtnVariant.Outline)
        }
        Spacer(Modifier.height(8.dp))
        val preview = if (auto) (if (create) Accents.AUTO_CREATE_PREVIEW else Accents.groupAccentHex(editing!!.id)) else color
        FlowRow(Modifier.alpha(if (auto) 0.45f else 1f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Accents.GROUP_COLOR_PRESETS.forEach { hex ->
                val sel = hex.equals(preview, ignoreCase = true)
                Box(
                    Modifier.size(32.dp).clip(CircleShape).background(hexColor(hex))
                        .then(if (sel) Modifier.border(2.dp, T.c.foreground, CircleShape) else Modifier)
                        .clickable(role = Role.RadioButton, onClickLabel = "Colour $hex") { auto = false; color = hex },
                    contentAlignment = Alignment.Center,
                ) { if (sel) Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(16.dp)) }
            }
        }
        if (auto) {
            Spacer(Modifier.height(6.dp))
            Text(
                if (create) "Color will follow the automatic palette from the group id after you save." else "Uses the automatic palette from the group id. Choose Custom to pick a preset.",
                fontSize = 11.sp, color = T.c.mutedForeground,
            )
        }
        Spacer(Modifier.height(12.dp))
        TInput(filter, { filter = it }, placeholder = "Filter tasks…")
        if (create) {
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TButton("Select all in list", { selected = selected + filtered.filter { allowed(it) }.map { it.id } }, size = BtnSize.Sm, variant = BtnVariant.Secondary, enabled = filtered.isNotEmpty())
                TButton("Clear selection", { selected = emptySet() }, size = BtnSize.Sm, variant = BtnVariant.Ghost, enabled = selected.isNotEmpty())
                if (filter.isNotBlank()) Text("${filtered.size} match${if (filtered.size != 1) "es" else ""}", fontSize = 12.sp, color = T.c.mutedForeground)
            }
        }
        Spacer(Modifier.height(10.dp))
        HorizontalDivider(color = T.c.border)
        if (!create) error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = T.c.destructive, fontSize = 14.sp) }
        Spacer(Modifier.height(4.dp))
        if (tasks.isEmpty()) {
            Text("No tasks yet.", fontSize = 14.sp, color = T.c.mutedForeground, modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        } else if (filtered.isEmpty()) {
            Text("No tasks match this search.", fontSize = 14.sp, color = T.c.mutedForeground, modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 320.dp)) {
            items(filtered, key = { it.id }) { t ->
                val ok = allowed(t)
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).alpha(if (ok) 1f else 0.6f)
                        .clickable(enabled = ok, role = Role.Checkbox) { selected = if (t.id in selected) selected - t.id else selected + t.id }
                        .padding(vertical = 2.dp, horizontal = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(
                        t.id in selected, { selected = if (it) selected + t.id else selected - t.id }, enabled = ok,
                    )
                    Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                        Text(t.name, fontSize = 14.sp, color = T.c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        t.taskGroup?.let { g -> if (create || !ok) { Spacer(Modifier.width(6.dp)); TBadge(g.name, Modifier.widthIn(max = 104.dp)) } }
                        if (t.hidden) { Spacer(Modifier.width(6.dp)); TBadge("Hidden", variant = BadgeVariant.Outline) }
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(Format.fmtMs(msInRange[t.id] ?: 0L), fontSize = 12.sp, color = T.c.mutedForeground, style = Tabular)
                }
            }
        }
    }
}
