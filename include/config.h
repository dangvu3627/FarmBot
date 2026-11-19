// config.h - every pin and hardware tunable in one place.
#pragma once
#include <stdint.h>

// ---- OLED (SSD1306 128x64, I2C) -------------------------------------------
constexpr uint8_t  PIN_I2C_SDA    = 21;
constexpr uint8_t  PIN_I2C_SCL    = 22;
constexpr uint8_t  OLED_I2C_ADDR  = 0x3C;     // 7-bit address
constexpr uint32_t OLED_I2C_HZ    = 400000;   // fast-mode I2C

// ---- Rotary encoder --------------------------------------------------------
// GPIO 32/33 have internal pull-ups (GPIO 34-39 do not; avoid them here).
constexpr uint8_t PIN_ENC_A   = 32;
constexpr uint8_t PIN_ENC_B   = 33;
constexpr uint8_t PIN_ENC_SW  = 25;   // push switch, active low, internal pull-up

// Quadrature edges per mechanical detent. Most detented encoders (EC11 etc.)
// produce a full 4-edge cycle per click. Set to 2 for half-cycle encoders.
constexpr int32_t ENC_COUNTS_PER_DETENT = 4;
// +1 or -1: flip if clockwise moves the cursor the wrong way.
constexpr int8_t  ENC_DIRECTION = 1;
// PCNT glitch filter in APB clock cycles (80 MHz APB -> 1023 = ~12.8 us).
// Pulses shorter than this are ignored in hardware. Max 1023.
constexpr uint16_t ENC_FILTER_APB_CYCLES = 1023;

// ---- Timing ----------------------------------------------------------------
constexpr uint32_t BUTTON_DEBOUNCE_MS = 25;
constexpr uint32_t LONG_PRESS_MS      = 1000;  // encoder hold that opens/closes the seed menu
constexpr uint32_t FRAME_MS           = 33;   // ~30 Hz game loop
constexpr uint32_t CPU_MHZ            = 80;

// ---- Saving (game seconds) -------------------------------------------------
constexpr uint32_t SAVE_MIN_INTERVAL_S = 30;    // event saves at most this often
                                                // (a power cut loses at most this much)
constexpr uint32_t SAVE_PERIODIC_S     = 300;   // unconditional save period

// ---- Web link (Wi-Fi hotspot + WebSocket) ---------------------------------
// The console makes its own WPA2 hotspot; the browser opens
// ws://192.168.4.1/ws. WPA2 needs a password of at least 8 characters.
constexpr char     AP_SSID[]       = "FarmBot";
constexpr char     AP_PASSWORD[]   = "farmbot123";
constexpr uint8_t  AP_CHANNEL      = 6;
constexpr uint8_t  AP_MAX_STATIONS = 4;      // Wi-Fi devices; only one browser may play
constexpr uint16_t WEB_PORT        = 80;
constexpr uint32_t NET_STATE_HEARTBEAT_MS = 2000;   // state is resent at least this often
constexpr uint32_t NET_CLIENT_TIMEOUT_MS  = 10000;  // drop a browser silent this long
