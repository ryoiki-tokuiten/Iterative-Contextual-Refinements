/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SerializationEngine - High-performance serialization with MessagePack and compression
 * Supports both MessagePack (binary, fast) and JSON (human-readable) formats.
 */

import { encode, decode } from '@msgpack/msgpack';

/**
 * Serialization format options.
 */
export type SerializationFormat = 'json' | 'msgpack';

/**
 * Options for serialization.
 */
export interface SerializationOptions {
    /** Output format: 'msgpack' for binary (faster, smaller) or 'json' for readable */
    format: SerializationFormat;

    /** Whether to compress the output with gzip */
    compress: boolean;

    /** Pretty-print JSON (ignored for msgpack) */
    prettyPrint?: boolean;

    /** Progress callback for large operations */
    onProgress?: (percent: number) => void;
}

/**
 * Default serialization options.
 */
const DEFAULT_SERIALIZATION_OPTIONS: SerializationOptions = {
    format: 'msgpack',
    compress: true,
    prettyPrint: false,
};

/**
 * File extension for each format/compression combination.
 */
export function getFileExtension(options: SerializationOptions): string {
    const base = options.format === 'msgpack' ? 'msgpack' : 'json';
    return options.compress ? `${base}.gz` : base;
}

/**
 * MIME type for each format.
 */
export function getMimeType(options: SerializationOptions): string {
    if (options.compress) {
        return 'application/gzip';
    }
    return options.format === 'msgpack'
        ? 'application/msgpack'
        : 'application/json';
}

/**
 * Serialize data to a Blob.
 * 
 * @param data The data to serialize
 * @param options Serialization options
 * @returns A Blob containing the serialized data
 */
export async function serialize(
    data: unknown,
    options: SerializationOptions = DEFAULT_SERIALIZATION_OPTIONS
): Promise<Blob> {
    options.onProgress?.(0);

    // Step 1: Encode to binary/string
    let encoded: Uint8Array;

    if (options.format === 'msgpack') {
        // MessagePack binary encoding
        encoded = encode(data);
    } else {
        // JSON string encoding
        const jsonString = options.prettyPrint
            ? JSON.stringify(data, null, 2)
            : JSON.stringify(data);
        encoded = new TextEncoder().encode(jsonString);
    }

    options.onProgress?.(50);

    // Step 2: Optionally compress
    if (options.compress) {
        encoded = await compressData(encoded);
    }

    options.onProgress?.(100);

    // Create a proper ArrayBuffer copy for Blob compatibility
    const buffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
    return new Blob([buffer], { type: getMimeType(options) });
}

/**
 * Deserialize data from a Blob or File.
 * Automatically detects format and compression.
 * 
 * @param blob The Blob/File to deserialize
 * @param onProgress Optional progress callback
 * @returns The deserialized data
 */
export async function deserialize<T = unknown>(
    blob: Blob,
    onProgress?: (percent: number) => void
): Promise<T> {
    onProgress?.(0);

    // Read the blob as ArrayBuffer
    const buffer = await blob.arrayBuffer();
    let data = new Uint8Array(buffer);

    onProgress?.(25);

    // Detect and handle compression (gzip magic bytes: 1f 8b)
    const isCompressed = data[0] === 0x1f && data[1] === 0x8b;
    if (isCompressed) {
        const decompressed = await decompressData(data);
        data = new Uint8Array(decompressed);
    }

    onProgress?.(50);

    // Detect format and decode
    // MessagePack typically starts with map/array markers or fixint
    // JSON typically starts with { (0x7b) or [ (0x5b)
    const firstByte = data[0];
    const isJson = firstByte === 0x7b || firstByte === 0x5b; // { or [

    let result: T;

    if (isJson) {
        const text = new TextDecoder().decode(data);
        result = JSON.parse(text) as T;
    } else {
        result = decode(data) as T;
    }

    onProgress?.(100);

    return result;
}

/**
 * Compress data using gzip via CompressionStream API.
 * Falls back to uncompressed if API not available.
 */
async function compressData(data: Uint8Array): Promise<Uint8Array> {
    // Check if CompressionStream is available (modern browsers)
    if (typeof CompressionStream === 'undefined') {
        console.warn('CompressionStream not available, skipping compression');
        return data;
    }

    try {
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        const stream = new Blob([buffer]).stream();
        const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
        const compressedBlob = await new Response(compressedStream).blob();
        const result = await compressedBlob.arrayBuffer();
        return new Uint8Array(result);
    } catch (error) {
        console.warn('Compression failed, returning uncompressed data:', error);
        return data;
    }
}

/**
 * Decompress gzip data using DecompressionStream API.
 * Falls back to returning original data if API not available.
 */
async function decompressData(data: Uint8Array): Promise<Uint8Array> {
    // Check if DecompressionStream is available
    if (typeof DecompressionStream === 'undefined') {
        console.warn('DecompressionStream not available');
        return data;
    }

    try {
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        const stream = new Blob([buffer]).stream();
        const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
        const decompressedBlob = await new Response(decompressedStream).blob();
        const result = await decompressedBlob.arrayBuffer();
        return new Uint8Array(result);
    } catch (error) {
        console.warn('Decompression failed:', error);
        throw new Error('Failed to decompress data. The file may be corrupted.');
    }
}

/**
 * Trigger a file download from a Blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Estimate the size of serialized data in bytes without actually serializing.
 * Useful for progress indicators and warnings.
 */
export function estimateSerializedSize(data: unknown): number {
    // Quick estimation using JSON stringify length
    // Actual msgpack will be ~30% smaller, gzip ~70% smaller
    try {
        return JSON.stringify(data).length;
    } catch {
        return 0;
    }
}

/**
 * Format bytes as human-readable string.
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
