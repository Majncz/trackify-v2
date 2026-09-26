package co.bitterlemon.trackify.ui.task

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

@Composable
fun TaskDetailScreen(id: String, onBack: () -> Unit) {
    Text("Task $id")
}
