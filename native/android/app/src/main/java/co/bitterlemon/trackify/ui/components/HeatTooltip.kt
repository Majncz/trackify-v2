package co.bitterlemon.trackify.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import co.bitterlemon.trackify.ui.theme.T

/** A popover card anchored above a point (in window px) — used for chart / heatmap tooltips. */
@Composable
fun TooltipPopup(anchorInWindow: IntOffset, onDismiss: () -> Unit, width: Int = 260, content: @Composable ColumnScope.() -> Unit) {
    val provider = object : PopupPositionProvider {
        override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
            val x = (anchorInWindow.x - popupContentSize.width / 2).coerceIn(8, (windowSize.width - popupContentSize.width - 8).coerceAtLeast(8))
            var y = anchorInWindow.y - popupContentSize.height - 12
            if (y < 8) y = anchorInWindow.y + 24
            return IntOffset(x, y)
        }
    }
    Popup(popupPositionProvider = provider, onDismissRequest = onDismiss, properties = PopupProperties(focusable = true)) {
        Column(
            Modifier
                .widthIn(max = width.dp)
                .shadow(10.dp, RoundedCornerShape(10.dp))
                .clip(RoundedCornerShape(10.dp))
                .background(T.c.card)
                .border(1.dp, T.c.border, RoundedCornerShape(10.dp))
                .padding(12.dp),
            content = content,
        )
    }
}

@Composable
fun TooltipRow(color: Color, name: String, value: String) {
    Row(verticalAlignment = Alignment.Top, modifier = Modifier.padding(vertical = 1.dp)) {
        Spacer(Modifier.padding(top = 4.dp).size(8.dp).clip(RoundedCornerShape(2.dp)).background(color))
        Spacer(Modifier.width(8.dp))
        Text(name, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
        Text("  · $value", fontSize = 12.sp, color = T.c.mutedForeground)
    }
}

@Suppress("unused")
private fun Modifier.bordered() = this.border(1.dp, Color.Transparent)
