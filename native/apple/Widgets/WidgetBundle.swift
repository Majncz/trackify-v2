import WidgetKit
import SwiftUI

@main
struct TrackifyWidgetBundle: WidgetBundle {
    var body: some Widget {
        TimerWidget()
        TeamWidget()
        #if os(iOS)
        TrackifyLiveActivity()
        if #available(iOS 18.0, *) { TimerControl() }
        #endif
    }
}
