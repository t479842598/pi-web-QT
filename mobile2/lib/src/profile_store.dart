import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'models.dart';

/// Stores multiple saved Pi Web server profiles.
///
/// Layout:
/// - SharedPreferences `pi_server_profiles`: JSON array of
///   `{"id","baseUrl","username"}` (no password).
/// - SharedPreferences `pi_active_server_id`: id of the active profile.
/// - SecureStorage `pi_server_password_<id>`: per-profile password.
///
/// Legacy single-profile keys (`pi_server_base_url`, `pi_server_username`,
/// `pi_server_password`) are migrated into the list on first read and then
/// removed, so upgrades from the previous version keep the saved server.
class ProfileStore {
  static const _profilesKey = 'pi_server_profiles';
  static const _activeIdKey = 'pi_active_server_id';

  // Legacy single-profile keys, migrated on first access.
  static const _legacyBaseUrlKey = 'pi_server_base_url';
  static const _legacyUsernameKey = 'pi_server_username';
  static const _legacyPasswordKey = 'pi_server_password';

  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();

  String _passwordKey(String id) => 'pi_server_password_$id';

  Future<List<ServerProfile>> readAll() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(_profilesKey);
    final profiles = <ServerProfile>[];
    if (stored != null) {
      try {
        final decoded = jsonDecode(stored);
        if (decoded is List) {
          for (final item in decoded) {
            if (item is! Map) continue;
            final json = Map<String, dynamic>.from(item);
            final baseUrl = json['baseUrl']?.toString();
            final username = json['username']?.toString();
            if (baseUrl == null || username == null) continue;
            final id =
                json['id']?.toString() ??
                ServerProfile(
                  baseUrl: baseUrl,
                  username: username,
                  password: '',
                ).id;
            final password =
                await _secureStorage.read(key: _passwordKey(id)) ?? '';
            profiles.add(
              ServerProfile(
                id: id,
                baseUrl: baseUrl,
                username: username,
                password: password,
              ),
            );
          }
        }
      } catch (_) {
        // Corrupt list: ignore and fall through to legacy migration.
      }
    }
    if (profiles.isEmpty) {
      await _migrateLegacy(prefs);
      final migrated = await _readProfilesOnly(prefs);
      profiles.addAll(migrated);
    }
    return profiles;
  }

  Future<List<ServerProfile>> _readProfilesOnly(SharedPreferences prefs) async {
    final stored = prefs.getString(_profilesKey);
    final profiles = <ServerProfile>[];
    if (stored == null) return profiles;
    try {
      final decoded = jsonDecode(stored);
      if (decoded is List) {
        for (final item in decoded) {
          if (item is! Map) continue;
          final json = Map<String, dynamic>.from(item);
          final baseUrl = json['baseUrl']?.toString();
          final username = json['username']?.toString();
          if (baseUrl == null || username == null) continue;
          final id =
              json['id']?.toString() ??
              ServerProfile(
                baseUrl: baseUrl,
                username: username,
                password: '',
              ).id;
          final password =
              await _secureStorage.read(key: _passwordKey(id)) ?? '';
          profiles.add(
            ServerProfile(
              id: id,
              baseUrl: baseUrl,
              username: username,
              password: password,
            ),
          );
        }
      }
    } catch (_) {
      // Ignore corrupt list.
    }
    return profiles;
  }

  Future<void> _migrateLegacy(SharedPreferences prefs) async {
    final baseUrl = prefs.getString(_legacyBaseUrlKey);
    final username = prefs.getString(_legacyUsernameKey);
    final password = await _secureStorage.read(key: _legacyPasswordKey);
    if (baseUrl == null || username == null) return;
    final profile = ServerProfile(
      baseUrl: baseUrl,
      username: username,
      password: password ?? '',
    );
    await _saveToList(prefs, profile, setActive: true);
    await prefs.remove(_legacyBaseUrlKey);
    await prefs.remove(_legacyUsernameKey);
    await _secureStorage.delete(key: _legacyPasswordKey);
  }

  /// Reads the active profile, or null when none exists. Migrates legacy
  /// single-profile storage on first call.
  Future<ServerProfile?> read() async {
    final profiles = await readAll();
    final prefs = await SharedPreferences.getInstance();
    final activeId = prefs.getString(_activeIdKey);
    if (activeId == null) return null;
    return profiles.where((p) => p.id == activeId).firstOrNull;
  }

  /// Saves [profile] into the list and makes it active. Returns the profile
  /// with a stable id.
  Future<ServerProfile> save(ServerProfile profile) async {
    final prefs = await SharedPreferences.getInstance();
    final saved = await _saveToList(prefs, profile, setActive: true);
    return saved;
  }

  Future<void> setActive(String id) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_activeIdKey, id);
  }

  /// Removes a profile (including its stored password). Returns the id of the
  /// profile that should become active next, or null when the list is empty.
  Future<String?> delete(String id) async {
    final prefs = await SharedPreferences.getInstance();
    final profiles = await _readProfilesOnly(prefs);
    final remaining = profiles.where((p) => p.id != id).map(_toJson).toList();
    if (remaining.isEmpty) {
      await prefs.remove(_profilesKey);
    } else {
      await prefs.setString(_profilesKey, jsonEncode(remaining));
    }
    await _secureStorage.delete(key: _passwordKey(id));
    final activeId = prefs.getString(_activeIdKey);
    if (activeId == id) {
      final next = profiles.where((p) => p.id != id).firstOrNull;
      if (next == null) {
        await prefs.remove(_activeIdKey);
      } else {
        await prefs.setString(_activeIdKey, next.id);
      }
      return next?.id;
    }
    return null;
  }

  Future<ServerProfile> _saveToList(
    SharedPreferences prefs,
    ServerProfile profile, {
    required bool setActive,
  }) async {
    final profiles = await _readProfilesOnly(prefs);
    final existing = profiles.indexWhere((p) => p.id == profile.id);
    final updated = ServerProfile(
      id: profile.id,
      baseUrl: profile.baseUrl,
      username: profile.username,
      password: profile.password,
    );
    final jsonList = profiles.map(_toJson).toList();
    if (existing >= 0) {
      jsonList[existing] = _toJson(updated);
    } else {
      jsonList.add(_toJson(updated));
    }
    await prefs.setString(_profilesKey, jsonEncode(jsonList));
    if (setActive) {
      await prefs.setString(_activeIdKey, updated.id);
    }
    if (profile.password.isNotEmpty) {
      await _secureStorage.write(
        key: _passwordKey(updated.id),
        value: profile.password,
      );
    }
    return updated;
  }

  Map<String, dynamic> _toJson(ServerProfile profile) => {
    'id': profile.id,
    'baseUrl': profile.baseUrl,
    'username': profile.username,
  };

  /// Clears the active session only; keeps the saved server list intact.
  Future<void> clearActive() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_activeIdKey);
  }

  /// Removes every saved profile and its passwords.
  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    final profiles = await _readProfilesOnly(prefs);
    for (final profile in profiles) {
      await _secureStorage.delete(key: _passwordKey(profile.id));
    }
    await prefs.remove(_profilesKey);
    await prefs.remove(_activeIdKey);
    await prefs.remove(_legacyBaseUrlKey);
    await prefs.remove(_legacyUsernameKey);
    await _secureStorage.delete(key: _legacyPasswordKey);
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
