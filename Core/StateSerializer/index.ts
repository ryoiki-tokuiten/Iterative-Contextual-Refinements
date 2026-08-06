/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * StateSerializer - Public exports for the state serialization module
 */

// Core interfaces and types
export { getModeHandler } from './ModeStateHandler';

// State sanitization
export {
    sanitizeState,
} from './StateSanitizer';

// Versioning and migration
export {
    CURRENT_STATE_VERSION,
    type VersionedState,
    type ExportedConfig,
    isVersionedState,
} from './StateVersion';

// Serialization engine
export {
    type SerializationOptions,
    serialize,
    deserialize,
    downloadBlob,
    getFileExtension,
    formatBytes,
    estimateSerializedSize,
} from './SerializationEngine';

// Initialize handlers on import
import './handlers';
