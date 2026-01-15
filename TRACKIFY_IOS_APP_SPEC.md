# Trackify iOS App Specification

## Table of Contents
1. [Overview](#overview)
2. [App Features](#app-features)
3. [Technical Requirements](#technical-requirements)
4. [API Reference](#api-reference)
5. [WebSocket Real-Time Integration](#websocket-real-time-integration)
6. [Data Models](#data-models)
7. [Live Activities Implementation](#live-activities-implementation)
8. [Authentication Flow](#authentication-flow)
9. [Timer State Management](#timer-state-management)
10. [Error Handling](#error-handling)
11. [Implementation Checklist](#implementation-checklist)

---

## Overview

### What is Trackify?
Trackify is a time tracking application that allows users to:
- Create and manage tasks (projects)
- Start/stop timers to track time spent on tasks
- View time entries (events) logged against tasks
- See statistics for today and all-time totals

### Backend Information
- **Production API Base URL**: `https://trackify.ranajakub.com`
- **Development API Base URL**: `https://dev.trackify.ranajakub.com`
- **Socket.io Server**: Same URLs, using `/socket.io` path
- **Authentication**: Bearer token-based authentication

### iOS App Purpose
The iOS app provides:
1. Full time tracking functionality on mobile
2. **Live Activities** on Lock Screen and Dynamic Island showing the currently running timer
3. Real-time sync with the web app via WebSocket

---

## App Features

### Core Features

#### 1. Authentication
- Login with email/password
- Secure token storage in Keychain
- Auto-login with stored token
- Logout functionality

#### 2. Task Management
- View list of all tasks (sorted alphabetically)
- Create new tasks
- Rename existing tasks
- Delete (hide) tasks - soft delete, task becomes hidden but data preserved
- Tasks contain associated time entries (events)

#### 3. Timer
- Start timer on any task
- Stop timer (automatically creates a time entry)
- View elapsed time in real-time
- Only ONE timer can run at a time (per user)
- Starting a new timer automatically stops any running timer
- Adjust timer start time (move back in time) with overlap validation

#### 4. Events (Time Entries)
- View all time entries
- Each entry shows: task name, entry name, duration, timestamp
- Edit event duration or name
- Delete events

#### 5. Statistics
- Today's total tracked time
- All-time total tracked time
- Per-task breakdown

### Live Activities Features

#### Lock Screen Widget
- Shows task name being tracked
- Shows elapsed time (updating in real-time)
- Shows start time
- Tap to open app

#### Dynamic Island (Compact)
- Shows abbreviated task name
- Shows elapsed time counter

#### Dynamic Island (Expanded)
- Full task name
- Elapsed time
- Start/Stop button

---

## Technical Requirements

### Minimum iOS Version
- iOS 16.1+ (required for Live Activities)

### Frameworks Required
- **SwiftUI** - UI framework
- **ActivityKit** - Live Activities and Dynamic Island
- **WidgetKit** - Widget extension for Live Activities
- **Foundation** - Networking, JSON, dates
- **Security** - Keychain for token storage

### Dependencies (Swift Package Manager)
```swift
// Package.swift or Xcode SPM
dependencies: [
    .package(url: "https://github.com/socketio/socket.io-client-swift.git", from: "16.0.0")
]
```

### Project Structure
```
Trackify/
├── TrackifyApp.swift              # App entry point
├── Models/
│   ├── User.swift
│   ├── Task.swift
│   ├── Event.swift
│   ├── TimerState.swift
│   └── AuthToken.swift
├── Services/
│   ├── APIService.swift           # REST API calls
│   ├── SocketService.swift        # WebSocket management
│   ├── AuthService.swift          # Authentication logic
│   └── KeychainService.swift      # Secure token storage
├── ViewModels/
│   ├── AuthViewModel.swift
│   ├── TasksViewModel.swift
│   └── TimerViewModel.swift
├── Views/
│   ├── LoginView.swift
│   ├── TaskListView.swift
│   ├── TaskRowView.swift
│   ├── TimerView.swift
│   └── StatsView.swift
├── LiveActivity/
│   └── TimerActivityAttributes.swift
└── TrackifyWidgetExtension/       # Separate target
    ├── TrackifyWidgetBundle.swift
    └── TimerLiveActivity.swift
```

---

## API Reference

### Base Configuration

All API requests (except login) require authentication:

```swift
// HTTP Header for all authenticated requests
Authorization: Bearer <token>
Content-Type: application/json
```

### Authentication Endpoints

#### POST /api/auth/token - Login
Authenticates user and returns an API token.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "userpassword"
}
```

**Response (200 OK):**
```json
{
  "token": "64-character-hex-string",
  "expiresAt": "2026-02-14T12:00:00.000Z",
  "user": {
    "id": "uuid-string",
    "email": "user@example.com"
  }
}
```

**Error Responses:**
- `400` - Invalid request body (Zod validation error)
- `401` - Invalid email or password
- `500` - Internal server error

**Swift Example:**
```swift
struct LoginRequest: Codable {
    let email: String
    let password: String
}

struct LoginResponse: Codable {
    let token: String
    let expiresAt: String
    let user: User
}

struct User: Codable {
    let id: String
    let email: String
}

func login(email: String, password: String) async throws -> LoginResponse {
    var request = URLRequest(url: URL(string: "\(baseURL)/api/auth/token")!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(LoginRequest(email: email, password: password))
    
    let (data, response) = try await URLSession.shared.data(for: request)
    
    guard let httpResponse = response as? HTTPURLResponse else {
        throw APIError.invalidResponse
    }
    
    switch httpResponse.statusCode {
    case 200:
        return try JSONDecoder().decode(LoginResponse.self, from: data)
    case 401:
        throw APIError.invalidCredentials
    default:
        throw APIError.serverError(httpResponse.statusCode)
    }
}
```

#### DELETE /api/auth/token - Logout
Revokes the current API token.

**Request Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Swift Example:**
```swift
func logout() async throws {
    var request = URLRequest(url: URL(string: "\(baseURL)/api/auth/token")!)
    request.httpMethod = "DELETE"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    
    let (_, response) = try await URLSession.shared.data(for: request)
    // Clear local token storage after successful logout
}
```

---

### Tasks Endpoints

#### GET /api/tasks - List Tasks
Returns all non-hidden tasks for the authenticated user.

**Query Parameters:**
- `hidden` (optional): Set to `"true"` to get hidden tasks instead

**Response (200 OK):**
```json
[
  {
    "id": "task-uuid",
    "name": "Project Alpha",
    "hidden": false,
    "createdAt": "2026-01-01T10:00:00.000Z",
    "updatedAt": "2026-01-15T10:00:00.000Z",
    "userId": "user-uuid",
    "events": [
      {
        "id": "event-uuid",
        "createdAt": "2026-01-15T09:00:00.000Z",
        "duration": 3600000,
        "name": "Time entry",
        "taskId": "task-uuid"
      }
    ]
  }
]
```

**Swift Models:**
```swift
struct Task: Codable, Identifiable {
    let id: String
    let name: String
    let hidden: Bool
    let createdAt: String
    let updatedAt: String
    let userId: String
    let events: [Event]
}

struct Event: Codable, Identifiable {
    let id: String
    let createdAt: String  // ISO 8601 timestamp - this is when the timer STARTED
    let duration: Int      // Duration in MILLISECONDS
    let name: String
    let taskId: String
}
```

**Swift Example:**
```swift
func fetchTasks() async throws -> [Task] {
    var request = URLRequest(url: URL(string: "\(baseURL)/api/tasks")!)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    
    let (data, _) = try await URLSession.shared.data(for: request)
    return try JSONDecoder().decode([Task].self, from: data)
}
```

#### POST /api/tasks - Create Task

**Request:**
```json
{
  "name": "New Project"
}
```

**Validation:**
- `name`: String, 1-100 characters

**Response (201 Created):**
```json
{
  "id": "new-task-uuid",
  "name": "New Project",
  "hidden": false,
  "createdAt": "2026-01-15T12:00:00.000Z",
  "updatedAt": "2026-01-15T12:00:00.000Z",
  "userId": "user-uuid",
  "events": []
}
```

#### GET /api/tasks/:id - Get Single Task

**Response (200 OK):**
```json
{
  "id": "task-uuid",
  "name": "Project Alpha",
  "hidden": false,
  "createdAt": "2026-01-01T10:00:00.000Z",
  "updatedAt": "2026-01-15T10:00:00.000Z",
  "userId": "user-uuid",
  "events": [...]
}
```

**Error:** `404` if task not found or doesn't belong to user

#### PUT /api/tasks/:id - Update Task

**Request:**
```json
{
  "name": "Renamed Project",
  "hidden": false
}
```

Both fields are optional - only include what you want to update.

**Response (200 OK):** Returns updated task object

#### DELETE /api/tasks/:id - Delete (Hide) Task
Soft deletes the task by setting `hidden: true`. Also stops any running timer for this task.

**Response (200 OK):**
```json
{
  "success": true,
  "taskHidden": true
}
```

---

### Events Endpoints

#### GET /api/events - List Events

**Query Parameters:**
- `taskId` (optional): Filter events by task

**Response (200 OK):**
```json
[
  {
    "id": "event-uuid",
    "createdAt": "2026-01-15T09:00:00.000Z",
    "duration": 3600000,
    "name": "Time entry",
    "taskId": "task-uuid",
    "task": {
      "name": "Project Alpha"
    }
  }
]
```

#### POST /api/events - Create Event
Creates a new time entry. This is called automatically when stopping a timer.

**Request:**
```json
{
  "taskId": "task-uuid",
  "name": "Time entry",
  "duration": 3600000,
  "createdAt": "2026-01-15T09:00:00.000Z"
}
```

**Field Details:**
- `taskId`: UUID of the task (required)
- `name`: Display name for the entry (defaults to "Time entry")
- `duration`: Duration in **MILLISECONDS** (required, must be positive integer)
- `createdAt`: ISO 8601 timestamp of when the timer STARTED (optional, defaults to now)

**Response (201 Created):**
```json
{
  "id": "new-event-uuid",
  "createdAt": "2026-01-15T09:00:00.000Z",
  "duration": 3600000,
  "name": "Time entry",
  "taskId": "task-uuid",
  "task": {
    "name": "Project Alpha"
  }
}
```

**Error Responses:**
- `400` - Validation error
- `404` - Task not found
- `409` - Time overlap with existing event (see Overlap Handling section)

#### PUT /api/events/:id - Update Event

**Request:**
```json
{
  "name": "Updated entry name",
  "duration": 7200000
}
```

Both fields optional.

**Response (200 OK):** Returns updated event object

#### DELETE /api/events/:id - Delete Event

**Response (200 OK):**
```json
{
  "success": true
}
```

---

### Statistics Endpoint

#### GET /api/stats - Get Time Statistics

**Query Parameters:**
- `timezone` (optional): IANA timezone string (e.g., "America/New_York"). Defaults to "UTC"

**Response (200 OK):**
```json
{
  "tasks": [
    {
      "taskId": "task-uuid",
      "taskName": "Project Alpha",
      "totalTime": 36000000,
      "todayTime": 7200000
    }
  ],
  "grandTotal": 72000000,
  "todayTotal": 14400000
}
```

**Field Details:**
- All time values are in **MILLISECONDS**
- `todayTime` / `todayTotal` is calculated based on the provided timezone

**Swift Example:**
```swift
struct Stats: Codable {
    let tasks: [TaskStats]
    let grandTotal: Int
    let todayTotal: Int
}

struct TaskStats: Codable {
    let taskId: String
    let taskName: String
    let totalTime: Int
    let todayTime: Int
}

func fetchStats() async throws -> Stats {
    let timezone = TimeZone.current.identifier
    var request = URLRequest(url: URL(string: "\(baseURL)/api/stats?timezone=\(timezone)")!)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    
    let (data, _) = try await URLSession.shared.data(for: request)
    return try JSONDecoder().decode(Stats.self, from: data)
}
```

---

### Timer Validation Endpoint

#### POST /api/timer/validate-start - Validate Start Time Adjustment
Validates that adjusting a timer's start time won't cause overlaps with existing events.

**Request:**
```json
{
  "newStartTime": "2026-01-15T08:30:00.000Z"
}
```

**Response (200 OK):**
```json
{
  "valid": true
}
```

**Error Responses:**
- `400` - Start time in the future or invalid duration
- `409` - Would overlap with existing event

---

## WebSocket Real-Time Integration

The app uses Socket.io for real-time timer synchronization across devices.

### Connection Setup

**Server URL:** Same as API base URL
**Path:** `/socket.io`

```swift
import SocketIO

class SocketService: ObservableObject {
    private var manager: SocketManager!
    private var socket: SocketIOClient!
    private let token: String
    
    @Published var isConnected = false
    @Published var timerState: TimerState?
    
    init(baseURL: String, token: String) {
        self.token = token
        
        manager = SocketManager(
            socketURL: URL(string: baseURL)!,
            config: [
                .log(false),
                .path("/socket.io"),
                .compress,
                .forceWebsockets(true)
            ]
        )
        
        socket = manager.defaultSocket
        setupHandlers()
    }
    
    func connect() {
        socket.connect()
    }
    
    func disconnect() {
        socket.disconnect()
    }
    
    private func setupHandlers() {
        socket.on(clientEvent: .connect) { [weak self] _, _ in
            guard let self = self else { return }
            self.isConnected = true
            // Authenticate with token immediately after connection
            self.socket.emit("authenticate", ["token": self.token])
        }
        
        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            self?.isConnected = false
        }
        
        socket.on("auth:success") { [weak self] data, _ in
            // Authentication successful, request current timer state
            self?.socket.emit("timer:request-state")
        }
        
        socket.on("auth:error") { data, _ in
            // Handle auth error - token may be expired
            print("Socket auth error:", data)
        }
        
        // Timer event handlers (see below)
    }
}
```

### Authentication

After connecting, immediately emit the `authenticate` event with your token:

```swift
// Emit after socket connects
socket.emit("authenticate", ["token": apiToken])
```

**Server Events:**
- `auth:success` - Authentication successful, includes `{ userId: string }`
- `auth:error` - Authentication failed, includes `{ message: string }` - socket will be disconnected

### Timer Events

#### Client -> Server Events

##### timer:start
Start a timer for a task.

```swift
socket.emit("timer:start", ["taskId": taskId])
```

##### timer:stop
Stop the current timer.

```swift
socket.emit("timer:stop", [
    "taskId": taskId,
    "duration": duration  // Duration in milliseconds
])
```

**Important:** After emitting `timer:stop`, you must also call `POST /api/events` to save the time entry to the database. The socket only manages the real-time state.

##### timer:request-state
Request the current timer state (call after auth:success).

```swift
socket.emit("timer:request-state")
```

##### timer:update-start
Adjust the start time of a running timer.

```swift
socket.emit("timer:update-start", [
    "taskId": taskId,
    "newStartTime": newStartTimeMs  // Unix timestamp in milliseconds
])
```

#### Server -> Client Events

##### timer:started
Broadcast when a timer starts (from any device).

```swift
socket.on("timer:started") { data, _ in
    guard let dict = data.first as? [String: Any],
          let taskId = dict["taskId"] as? String,
          let startTime = dict["startTime"] as? Double else { return }
    
    // Update timer state
    // startTime is Unix timestamp in milliseconds
}
```

**Payload:**
```json
{
  "taskId": "task-uuid",
  "startTime": 1705312800000
}
```

##### timer:stopped
Broadcast when a timer stops (from any device).

```swift
socket.on("timer:stopped") { data, _ in
    guard let dict = data.first as? [String: Any],
          let taskId = dict["taskId"] as? String,
          let duration = dict["duration"] as? Int else { return }
    
    // Clear timer state
    // Refresh tasks/stats to show new event
}
```

**Payload:**
```json
{
  "taskId": "task-uuid",
  "duration": 3600000
}
```

##### timer:state
Response to `timer:request-state` if a timer is running.

```swift
socket.on("timer:state") { data, _ in
    guard let dict = data.first as? [String: Any],
          let taskId = dict["taskId"] as? String,
          let startTime = dict["startTime"] as? Double,
          let running = dict["running"] as? Bool else { return }
    
    if running {
        // Set timer state with startTime
    }
}
```

**Payload:**
```json
{
  "taskId": "task-uuid",
  "startTime": 1705312800000,
  "running": true
}
```

##### timer:start-updated
Broadcast when a timer's start time is adjusted.

```swift
socket.on("timer:start-updated") { data, _ in
    guard let dict = data.first as? [String: Any],
          let taskId = dict["taskId"] as? String,
          let startTime = dict["startTime"] as? Double else { return }
    
    // Update timer startTime
}
```

##### timer:error
Error response for timer operations.

```swift
socket.on("timer:error") { data, _ in
    guard let dict = data.first as? [String: Any],
          let action = dict["action"] as? String,
          let message = dict["message"] as? String else { return }
    
    // Handle error - action is "start", "update-start", etc.
}
```

**Payload:**
```json
{
  "action": "update-start",
  "message": "This would overlap with \"Project Alpha: Time entry\""
}
```

#### Task/Event Sync Events (Optional)

The server also broadcasts these events which you can listen to for real-time sync:

- `task:created` - A new task was created
- `task:updated` - A task was updated
- `task:deleted` - A task was deleted (hidden)
- `event:created` - A new event was created

These are primarily for multi-device sync. The iOS app should invalidate/refresh local data when receiving these.

### Complete Socket Service Example

```swift
import Foundation
import SocketIO
import Combine

struct TimerState {
    let taskId: String
    let startTime: Date
    var elapsed: TimeInterval {
        Date().timeIntervalSince(startTime)
    }
}

class SocketService: ObservableObject {
    private var manager: SocketManager!
    private var socket: SocketIOClient!
    private let token: String
    
    @Published var isConnected = false
    @Published var timerState: TimerState?
    @Published var socketError: String?
    
    // Publishers for data refresh notifications
    let tasksNeedRefresh = PassthroughSubject<Void, Never>()
    let statsNeedRefresh = PassthroughSubject<Void, Never>()
    
    init(baseURL: String, token: String) {
        self.token = token
        
        manager = SocketManager(
            socketURL: URL(string: baseURL)!,
            config: [
                .log(false),
                .path("/socket.io"),
                .compress,
                .forceWebsockets(true),
                .reconnects(true),
                .reconnectWait(1),
                .reconnectWaitMax(5)
            ]
        )
        
        socket = manager.defaultSocket
        setupHandlers()
    }
    
    func connect() {
        socket.connect()
    }
    
    func disconnect() {
        socket.disconnect()
    }
    
    private func setupHandlers() {
        // Connection events
        socket.on(clientEvent: .connect) { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.isConnected = true
                self?.socket.emit("authenticate", ["token": self?.token ?? ""])
            }
        }
        
        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.isConnected = false
            }
        }
        
        // Auth events
        socket.on("auth:success") { [weak self] _, _ in
            self?.socket.emit("timer:request-state")
        }
        
        socket.on("auth:error") { [weak self] data, _ in
            DispatchQueue.main.async {
                if let dict = data.first as? [String: Any],
                   let message = dict["message"] as? String {
                    self?.socketError = message
                }
            }
        }
        
        // Timer events
        socket.on("timer:started") { [weak self] data, _ in
            guard let dict = data.first as? [String: Any],
                  let taskId = dict["taskId"] as? String,
                  let startTimeMs = dict["startTime"] as? Double else { return }
            
            DispatchQueue.main.async {
                self?.timerState = TimerState(
                    taskId: taskId,
                    startTime: Date(timeIntervalSince1970: startTimeMs / 1000)
                )
            }
        }
        
        socket.on("timer:stopped") { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.timerState = nil
                self?.tasksNeedRefresh.send()
                self?.statsNeedRefresh.send()
            }
        }
        
        socket.on("timer:state") { [weak self] data, _ in
            guard let dict = data.first as? [String: Any],
                  let taskId = dict["taskId"] as? String,
                  let startTimeMs = dict["startTime"] as? Double,
                  let running = dict["running"] as? Bool,
                  running else { return }
            
            DispatchQueue.main.async {
                self?.timerState = TimerState(
                    taskId: taskId,
                    startTime: Date(timeIntervalSince1970: startTimeMs / 1000)
                )
            }
        }
        
        socket.on("timer:start-updated") { [weak self] data, _ in
            guard let dict = data.first as? [String: Any],
                  let taskId = dict["taskId"] as? String,
                  let startTimeMs = dict["startTime"] as? Double else { return }
            
            DispatchQueue.main.async {
                if self?.timerState?.taskId == taskId {
                    self?.timerState = TimerState(
                        taskId: taskId,
                        startTime: Date(timeIntervalSince1970: startTimeMs / 1000)
                    )
                }
            }
        }
        
        socket.on("timer:error") { [weak self] data, _ in
            guard let dict = data.first as? [String: Any],
                  let message = dict["message"] as? String else { return }
            
            DispatchQueue.main.async {
                self?.socketError = message
            }
        }
        
        // Data sync events
        socket.on("task:created") { [weak self] _, _ in
            self?.tasksNeedRefresh.send()
        }
        
        socket.on("task:updated") { [weak self] _, _ in
            self?.tasksNeedRefresh.send()
        }
        
        socket.on("task:deleted") { [weak self] _, _ in
            self?.tasksNeedRefresh.send()
        }
        
        socket.on("event:created") { [weak self] _, _ in
            self?.tasksNeedRefresh.send()
            self?.statsNeedRefresh.send()
        }
    }
    
    // MARK: - Timer Actions
    
    func startTimer(taskId: String) {
        socket.emit("timer:start", ["taskId": taskId])
    }
    
    func stopTimer(taskId: String, duration: Int) {
        socket.emit("timer:stop", ["taskId": taskId, "duration": duration])
    }
    
    func updateTimerStart(taskId: String, newStartTime: Date) {
        let ms = Int(newStartTime.timeIntervalSince1970 * 1000)
        socket.emit("timer:update-start", ["taskId": taskId, "newStartTime": ms])
    }
}
```

---

## Data Models

### Swift Model Definitions

```swift
import Foundation

// MARK: - Auth Models

struct AuthToken: Codable {
    let token: String
    let expiresAt: String  // ISO 8601
    let user: User
    
    var expirationDate: Date? {
        ISO8601DateFormatter().date(from: expiresAt)
    }
    
    var isExpired: Bool {
        guard let expDate = expirationDate else { return true }
        return Date() > expDate
    }
}

struct User: Codable, Identifiable {
    let id: String
    let email: String
}

// MARK: - Task Models

struct Task: Codable, Identifiable {
    let id: String
    let name: String
    let hidden: Bool
    let createdAt: String
    let updatedAt: String
    let userId: String
    let events: [Event]
    
    /// Total time in milliseconds
    var totalDuration: Int {
        events.reduce(0) { $0 + $1.duration }
    }
    
    /// Total time formatted as "Xh Ym"
    var formattedTotalDuration: String {
        formatDuration(totalDuration)
    }
}

struct CreateTaskRequest: Codable {
    let name: String
}

struct UpdateTaskRequest: Codable {
    let name: String?
    let hidden: Bool?
}

// MARK: - Event Models

struct Event: Codable, Identifiable {
    let id: String
    let createdAt: String   // ISO 8601 - when timer STARTED
    let duration: Int       // Milliseconds
    let name: String
    let taskId: String
    let task: TaskInfo?     // Only present when fetching events directly
    
    /// Start date parsed from createdAt
    var startDate: Date? {
        ISO8601DateFormatter().date(from: createdAt)
    }
    
    /// Duration formatted as "Xh Ym"
    var formattedDuration: String {
        formatDuration(duration)
    }
}

struct TaskInfo: Codable {
    let name: String
}

struct CreateEventRequest: Codable {
    let taskId: String
    let name: String
    let duration: Int           // Milliseconds
    let createdAt: String       // ISO 8601 - when timer started
}

struct UpdateEventRequest: Codable {
    let name: String?
    let duration: Int?
}

// MARK: - Stats Models

struct Stats: Codable {
    let tasks: [TaskStats]
    let grandTotal: Int     // Milliseconds
    let todayTotal: Int     // Milliseconds
    
    var formattedGrandTotal: String {
        formatDuration(grandTotal)
    }
    
    var formattedTodayTotal: String {
        formatDuration(todayTotal)
    }
}

struct TaskStats: Codable {
    let taskId: String
    let taskName: String
    let totalTime: Int      // Milliseconds
    let todayTime: Int      // Milliseconds
}

// MARK: - Timer State

struct TimerState {
    let taskId: String
    let startTime: Date
    
    var elapsed: TimeInterval {
        Date().timeIntervalSince(startTime)
    }
    
    var elapsedMilliseconds: Int {
        Int(elapsed * 1000)
    }
    
    var formattedElapsed: String {
        formatDuration(elapsedMilliseconds)
    }
}

// MARK: - Helper Functions

func formatDuration(_ milliseconds: Int) -> String {
    let totalSeconds = milliseconds / 1000
    let hours = totalSeconds / 3600
    let minutes = (totalSeconds % 3600) / 60
    let seconds = totalSeconds % 60
    
    if hours > 0 {
        return String(format: "%dh %02dm", hours, minutes)
    } else if minutes > 0 {
        return String(format: "%dm %02ds", minutes, seconds)
    } else {
        return String(format: "%ds", seconds)
    }
}

func formatDurationLong(_ milliseconds: Int) -> String {
    let totalSeconds = milliseconds / 1000
    let hours = totalSeconds / 3600
    let minutes = (totalSeconds % 3600) / 60
    let seconds = totalSeconds % 60
    
    return String(format: "%02d:%02d:%02d", hours, minutes, seconds)
}
```

---

## Live Activities Implementation

### ActivityAttributes Definition

Create a Widget Extension target and define the activity attributes:

```swift
// In Widget Extension: TimerActivityAttributes.swift
import ActivityKit
import SwiftUI

struct TimerActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // Dynamic state that updates
        var startTime: Date
        var elapsedSeconds: Int  // For static fallback
    }
    
    // Static attributes set at start
    var taskId: String
    var taskName: String
}
```

### Live Activity Widget

```swift
// In Widget Extension: TimerLiveActivity.swift
import WidgetKit
import SwiftUI
import ActivityKit

struct TimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TimerActivityAttributes.self) { context in
            // Lock Screen presentation
            LockScreenTimerView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded presentation
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.attributes.taskName, systemImage: "timer")
                        .font(.headline)
                        .lineLimit(1)
                }
                
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: context.state.startTime...Date.distantFuture, countsDown: false)
                        .monospacedDigit()
                        .font(.title2.weight(.semibold))
                        .frame(width: 100)
                }
                
                DynamicIslandExpandedRegion(.bottom) {
                    Text("Tracking time...")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            } compactLeading: {
                // Compact leading - icon
                Image(systemName: "timer")
                    .foregroundColor(.orange)
            } compactTrailing: {
                // Compact trailing - elapsed time
                Text(timerInterval: context.state.startTime...Date.distantFuture, countsDown: false)
                    .monospacedDigit()
                    .frame(width: 50)
                    .font(.caption.weight(.semibold))
            } minimal: {
                // Minimal - just icon when space is very limited
                Image(systemName: "timer")
                    .foregroundColor(.orange)
            }
        }
    }
}

struct LockScreenTimerView: View {
    let context: ActivityViewContext<TimerActivityAttributes>
    
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(context.attributes.taskName)
                    .font(.headline)
                    .lineLimit(1)
                
                Text("Started at \(context.state.startTime.formatted(date: .omitted, time: .shortened))")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            // Timer display that counts up from startTime
            Text(timerInterval: context.state.startTime...Date.distantFuture, countsDown: false)
                .monospacedDigit()
                .font(.title.weight(.bold))
                .foregroundColor(.orange)
        }
        .padding()
        .activityBackgroundTint(.black.opacity(0.75))
    }
}
```

### Managing Live Activities from Main App

```swift
// In Main App: LiveActivityManager.swift
import ActivityKit
import Foundation

class LiveActivityManager: ObservableObject {
    @Published var currentActivity: Activity<TimerActivityAttributes>?
    
    func startActivity(taskId: String, taskName: String, startTime: Date) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            print("Live Activities not enabled")
            return
        }
        
        // End any existing activity first
        endActivity()
        
        let attributes = TimerActivityAttributes(
            taskId: taskId,
            taskName: taskName
        )
        
        let initialState = TimerActivityAttributes.ContentState(
            startTime: startTime,
            elapsedSeconds: Int(Date().timeIntervalSince(startTime))
        )
        
        let content = ActivityContent(state: initialState, staleDate: nil)
        
        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: nil  // No push updates, we update locally
            )
            currentActivity = activity
            print("Started Live Activity: \(activity.id)")
        } catch {
            print("Failed to start Live Activity: \(error)")
        }
    }
    
    func updateActivity(startTime: Date) {
        guard let activity = currentActivity else { return }
        
        let newState = TimerActivityAttributes.ContentState(
            startTime: startTime,
            elapsedSeconds: Int(Date().timeIntervalSince(startTime))
        )
        
        Task {
            await activity.update(
                ActivityContent(state: newState, staleDate: nil)
            )
        }
    }
    
    func endActivity() {
        guard let activity = currentActivity else { return }
        
        Task {
            let finalState = TimerActivityAttributes.ContentState(
                startTime: activity.content.state.startTime,
                elapsedSeconds: Int(Date().timeIntervalSince(activity.content.state.startTime))
            )
            
            await activity.end(
                ActivityContent(state: finalState, staleDate: nil),
                dismissalPolicy: .immediate
            )
        }
        
        currentActivity = nil
    }
    
    /// Call this on app launch to clean up any orphaned activities
    func cleanupOrphanedActivities() {
        for activity in Activity<TimerActivityAttributes>.activities {
            Task {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }
}
```

### Integrating with Timer

```swift
class TimerViewModel: ObservableObject {
    @Published var timerState: TimerState?
    
    private let socketService: SocketService
    private let liveActivityManager = LiveActivityManager()
    private var cancellables = Set<AnyCancellable>()
    
    init(socketService: SocketService, tasks: [Task]) {
        self.socketService = socketService
        
        // Observe timer state changes
        socketService.$timerState
            .sink { [weak self] state in
                self?.handleTimerStateChange(state, tasks: tasks)
            }
            .store(in: &cancellables)
    }
    
    private func handleTimerStateChange(_ state: TimerState?, tasks: [Task]) {
        self.timerState = state
        
        if let state = state {
            // Timer is running - start/update Live Activity
            let taskName = tasks.first { $0.id == state.taskId }?.name ?? "Timer"
            liveActivityManager.startActivity(
                taskId: state.taskId,
                taskName: taskName,
                startTime: state.startTime
            )
        } else {
            // Timer stopped - end Live Activity
            liveActivityManager.endActivity()
        }
    }
    
    func startTimer(taskId: String) {
        socketService.startTimer(taskId: taskId)
    }
    
    func stopTimer() {
        guard let state = timerState else { return }
        
        let duration = state.elapsedMilliseconds
        socketService.stopTimer(taskId: state.taskId, duration: duration)
        
        // Also save to database
        Task {
            try await APIService.shared.createEvent(
                taskId: state.taskId,
                name: "Time entry",
                duration: duration,
                createdAt: state.startTime
            )
        }
    }
}
```

### Complete Socket Service Example

```swift
import Foundation
import SocketIO
import Combine

struct TimerState {
    let taskId: String
    let startTime: Date
    var elapsed: TimeInterval {
        Date().timeIntervalSince(startTime)
    }
}

class SocketService: ObservableObject {
    private var manager: SocketManager!
    private var socket: SocketIOClient!
    private let token: String
    
    @Published var isConnected = false
    @Published var timerState: TimerState?
    @Published var socketError: String?
    
    let tasksNeedRefresh = PassthroughSubject<Void, Never>()
    let statsNeedRefresh = PassthroughSubject<Void, Never>()
    
    init(baseURL: String, token: String) {
        self.token = token
        manager = SocketManager(
            socketURL: URL(string: baseURL)!,
            config: [.log(false), .path("/socket.io"), .compress, .forceWebsockets(true),
                     .reconnects(true), .reconnectWait(1), .reconnectWaitMax(5)]
        )
        socket = manager.defaultSocket
        setupHandlers()
    }
    
    func connect() { socket.connect() }
    func disconnect() { socket.disconnect() }
    
    private func setupHandlers() {
        socket.on(clientEvent: .connect) { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.isConnected = true
                self?.socket.emit("authenticate", ["token": self?.token ?? ""])
            }
        }
        
        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            DispatchQueue.main.async { self?.isConnected = false }
        }
        
        socket.on("auth:success") { [weak self] _, _ in
            self?.socket.emit("timer:request-state")
        }
        
        socket.on("auth:error") { [weak self] data, _ in
            DispatchQueue.main.async {
                if let dict = data.first as? [String: Any], let msg = dict["message"] as? String {
                    self?.socketError = msg
                }
            }
        }
        
        socket.on("timer:started") { [weak self] data, _ in
            guard let dict = data.first as? [String: Any],
                  let taskId = dict["taskId"] as? String,
                  let startTimeMs = dict["startTime"] as? Double else { return }
            DispatchQueue.main.async {
                self?.timerState = TimerState(taskId: taskId, 
                    startTime: Date(timeIntervalSince1970: startTimeMs / 1000))
            }
        }
        
        socket.on("timer:stopped") { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.timerState = nil
                self?.tasksNeedRefresh.send()
                self?.statsNeedRefresh.send()
            }
        }
        
        socket.on("timer:state") { [weak self] data, _ in
            guard let dict = data.first as? [String: Any],
                  let taskId = dict["taskId"] as? String,
                  let startTimeMs = dict["startTime"] as? Double,
                  let running = dict["running"] as? Bool, running else { return }
            DispatchQueue.main.async {
                self?.timerState = TimerState(taskId: taskId,
                    startTime: Date(timeIntervalSince1970: startTimeMs / 1000))
            }
        }
        
        socket.on("timer:start-updated") { [weak self] data, _ in
            guard let dict = data.first as? [String: Any],
                  let taskId = dict["taskId"] as? String,
                  let startTimeMs = dict["startTime"] as? Double else { return }
            DispatchQueue.main.async {
                if self?.timerState?.taskId == taskId {
                    self?.timerState = TimerState(taskId: taskId,
                        startTime: Date(timeIntervalSince1970: startTimeMs / 1000))
                }
            }
        }
        
        socket.on("timer:error") { [weak self] data, _ in
            guard let dict = data.first as? [String: Any],
                  let message = dict["message"] as? String else { return }
            DispatchQueue.main.async { self?.socketError = message }
        }
        
        ["task:created", "task:updated", "task:deleted"].forEach { event in
            socket.on(event) { [weak self] _, _ in self?.tasksNeedRefresh.send() }
        }
        socket.on("event:created") { [weak self] _, _ in
            self?.tasksNeedRefresh.send()
            self?.statsNeedRefresh.send()
        }
    }
    
    func startTimer(taskId: String) {
        socket.emit("timer:start", ["taskId": taskId])
    }
    
    func stopTimer(taskId: String, duration: Int) {
        socket.emit("timer:stop", ["taskId": taskId, "duration": duration])
    }
    
    func updateTimerStart(taskId: String, newStartTime: Date) {
        let ms = Int(newStartTime.timeIntervalSince1970 * 1000)
        socket.emit("timer:update-start", ["taskId": taskId, "newStartTime": ms])
    }
}
```

---

## Data Models

### Swift Model Definitions

```swift
import Foundation

// MARK: - Auth Models
struct AuthToken: Codable {
    let token: String
    let expiresAt: String
    let user: User
    
    var expirationDate: Date? { ISO8601DateFormatter().date(from: expiresAt) }
    var isExpired: Bool {
        guard let expDate = expirationDate else { return true }
        return Date() > expDate
    }
}

struct User: Codable, Identifiable {
    let id: String
    let email: String
}

// MARK: - Task Models
struct Task: Codable, Identifiable {
    let id: String
    let name: String
    let hidden: Bool
    let createdAt: String
    let updatedAt: String
    let userId: String
    let events: [Event]
    
    var totalDuration: Int { events.reduce(0) { $0 + $1.duration } }
    var formattedTotalDuration: String { formatDuration(totalDuration) }
}

struct CreateTaskRequest: Codable { let name: String }
struct UpdateTaskRequest: Codable { let name: String?; let hidden: Bool? }

// MARK: - Event Models
struct Event: Codable, Identifiable {
    let id: String
    let createdAt: String   // ISO 8601 - when timer STARTED
    let duration: Int       // Milliseconds
    let name: String
    let taskId: String
    let task: TaskInfo?
    
    var startDate: Date? { ISO8601DateFormatter().date(from: createdAt) }
    var formattedDuration: String { formatDuration(duration) }
}

struct TaskInfo: Codable { let name: String }

struct CreateEventRequest: Codable {
    let taskId: String
    let name: String
    let duration: Int
    let createdAt: String
}

struct UpdateEventRequest: Codable { let name: String?; let duration: Int? }

// MARK: - Stats Models
struct Stats: Codable {
    let tasks: [TaskStats]
    let grandTotal: Int
    let todayTotal: Int
    
    var formattedGrandTotal: String { formatDuration(grandTotal) }
    var formattedTodayTotal: String { formatDuration(todayTotal) }
}

struct TaskStats: Codable {
    let taskId: String
    let taskName: String
    let totalTime: Int
    let todayTime: Int
}

// MARK: - Timer State
struct TimerState {
    let taskId: String
    let startTime: Date
    
    var elapsed: TimeInterval { Date().timeIntervalSince(startTime) }
    var elapsedMilliseconds: Int { Int(elapsed * 1000) }
    var formattedElapsed: String { formatDuration(elapsedMilliseconds) }
}

// MARK: - Helper Functions
func formatDuration(_ milliseconds: Int) -> String {
    let totalSeconds = milliseconds / 1000
    let hours = totalSeconds / 3600
    let minutes = (totalSeconds % 3600) / 60
    let seconds = totalSeconds % 60
    
    if hours > 0 { return String(format: "%dh %02dm", hours, minutes) }
    else if minutes > 0 { return String(format: "%dm %02ds", minutes, seconds) }
    else { return String(format: "%ds", seconds) }
}

func formatDurationLong(_ milliseconds: Int) -> String {
    let totalSeconds = milliseconds / 1000
    return String(format: "%02d:%02d:%02d", totalSeconds / 3600, 
                  (totalSeconds % 3600) / 60, totalSeconds % 60)
}
```
