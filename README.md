# JTP - Janky Transfer Protocol

A Node.js library implementing JTP (Janky Transfer Protocol), a UDP-based protocol for streaming variable-length data with automatic fragmentation and reassembly. Features a clean, stream-style API built on EventEmitter for reactive programming.

## Features

- **Stream-Style API**: Event-driven encoder and decoder with intuitive method names
- **Automatic Fragmentation**: Large payloads are automatically split into fragments that fit within UDP packet size limits
- **Multiple Message Types**: Support for up to 64 different message types (0-63) with independent message streams
- **Message Type Filtering**: Decoders can filter for specific message types at the packet level
- **Generic Payload Support**: Works with any Buffer data - no schema required
- **Event-Driven Architecture**: Built on EventEmitter for reactive programming patterns
- **Source Identification**: Source ID filtering for multi-source environments
- **Async-Friendly**: Support for callbacks and event-based flow control

## Installation

```bash
npm install jtp
```

## Quick Start

```javascript
const { JTPEncoder, JTPDecoder } = require('jtp');

// Create encoder and decoder with the same source ID
const encoder = new JTPEncoder({ source_id: 0x1234 });
const decoder = new JTPDecoder({ source_id: 0x1234 });

// Set up decoder events
decoder.on('message', (buffer, message_type, metadata) => {
    console.log(`Received complete message:
        Type: ${message_type}
        Message ID: ${metadata.message_id}
        Size: ${metadata.total_bytes} bytes
        Content: ${buffer.toString()}`);
});

// Set up encoder events
encoder.on('packet', (packet_buffer, packet_info) => {
    console.log(`Generated packet ${packet_info.fragment_number}/${packet_info.fragment_count}`);
    
    // Send packet over UDP (or pass directly to decoder for testing)
    decoder.decode_packet(packet_buffer);
});

encoder.on('message:encoded', (encoding_info) => {
    console.log(`Message ${encoding_info.message_id} encoded into ${encoding_info.fragment_count} packets`);
});

// Encode and send a message
const message_id = encoder.encode_message(Buffer.from('Hello, JTP!'), 1);
console.log(`Encoding message ${message_id}`);
```

## API Reference

### JTPEncoder

The encoder converts messages into JTP packets and emits them as events.

#### Constructor

```javascript
const encoder = new JTPEncoder({ source_id });
```

**Parameters:**
- `source_id` (number): 32-bit source identifier (0x00000000 to 0xFFFFFFFF)

#### Methods

##### `encode_message(message_buffer, message_type, callback?)`

Encodes a message and emits packets via events.

**Parameters:**
- `message_buffer` (Buffer): The message data to encode
- `message_type` (number): Message type (0-63)
- `callback` (function, optional): Called when encoding completes with metadata

**Returns:** `number|null` - The message ID assigned to this message, or null if validation failed

**Events Emitted:**
- `packet`: For each packet fragment generated
- `message:encoded`: When all packets for the message have been emitted
- `error`: If encoding fails

#### Events

##### `'packet'` Event
```javascript
encoder.on('packet', (packet_buffer, packet_info) => {
    // packet_buffer: Buffer containing the JTP packet
    // packet_info: { message_id, message_type, fragment_index, fragment_count, fragment_size }
});
```

##### `'message:encoded'` Event
```javascript
encoder.on('message:encoded', (metadata) => {
    // metadata: { message_id, message_type, fragment_count, total_bytes }
});
```

##### `'error'` Event
```javascript
encoder.on('error', (error) => {
    // error: Error object describing what went wrong
});
```

### JTPDecoder

The decoder receives JTP packets and reconstructs complete messages.

#### Constructor

```javascript
const decoder = new JTPDecoder({ source_id, message_types });
```

**Parameters:**
- `source_id` (number): 32-bit source identifier to listen for
- `message_types` (array, optional): Array of message types to accept (default: all types)

#### Methods

##### `decode_packet(packet_buffer)`

Process a single JTP packet.

**Parameters:**
- `packet_buffer` (Buffer): JTP packet to decode

**Returns:** `boolean` - true if packet was processed, false if ignored (wrong source/filtered type)

##### `reset_message_state(message_type?)`

Reset accumulator state for incomplete messages.

**Parameters:**
- `message_type` (number, optional): Specific message type to reset, or omit to reset all

##### `reset_message_state(message_type?)`

Reset accumulator state for incomplete messages.

**Parameters:**
- `message_type` (number, optional): Specific message type to reset, or omit to reset all

#### Events

##### `'message'` Event
```javascript
decoder.on('message', (message_buffer, message_type, metadata) => {
    // message_buffer: Buffer containing the complete message
    // message_type: Number indicating the message type (0-63)
    // metadata: { message_id, fragment_count, total_bytes }
});
```

##### `'message:start'` Event  
```javascript
decoder.on('message:start', (info) => {
    // info: { message_type, message_id, fragment_count }
    // Emitted when first fragment of a new message arrives
});
```

##### `'fragment:received'` Event
```javascript
decoder.on('fragment:received', (fragment_info) => {
    // fragment_info: { 
    //   message_type, 
    //   message_id, 
    //   fragment_index, 
    //   fragment_count,
    //   fragments_received
    // }
});
```

##### `'message:complete'` Event
```javascript
decoder.on('message:complete', (completion_info) => {
    // completion_info: { 
    //   message_type, 
    //   message_id, 
    //   fragment_count, 
    //   total_bytes 
    // }
});
```

##### `'message:incomplete'` Event
```javascript
decoder.on('message:incomplete', (incomplete_info) => {
    // incomplete_info: { 
    //   message_type, 
    //   message_id, 
    //   fragments_received, 
    //   fragment_count 
    // }
});
```

##### `'error'` Event
```javascript
decoder.on('error', (error) => {
    // error: Error object describing what went wrong
});
```javascript
## Message Type Filtering

```javascript
## Message Type Filtering

You can create decoders that only listen to specific message types for more efficient processing:

```javascript
const { JTPEncoder, JTPDecoder } = require('jtp');

// Create decoders that filter for specific message types
const encoder = new JTPEncoder({ source_id: 0x1234 });
const control_decoder = new JTPDecoder({ source_id: 0x1234, message_types: [1, 2, 3] }); // Only control messages
const data_decoder = new JTPDecoder({ source_id: 0x1234, message_types: [10, 11, 12] }); // Only data messages

control_decoder.on('message', (buffer, message_type) => {
    console.log(`Control message type ${message_type}: ${buffer.toString()}`);
});

data_decoder.on('message', (buffer, message_type) => {
    console.log(`Data message type ${message_type}: ${buffer.length} bytes`);
});

// Send different message types
encoder.on('packet', (packet) => {
    control_decoder.decode_packet(packet); // Filtered by message type
    data_decoder.decode_packet(packet);    // Filtered by message type
});

encoder.encode_message(Buffer.from('SYSTEM_READY'), 1);  // Control decoder will receive
encoder.encode_message(Buffer.from('sensor data'), 10); // Data decoder will receive
```

## Advanced Usage

### Using Callbacks

```javascript
const message_id = encoder.encode_message(large_buffer, 5, (error, result) => {
    if (error) {
        console.error('Encoding failed:', error.message);
    } else {
        console.log(`Message ${result.message_id} encoded into ${result.fragment_count} packets`);
    }
});
```

### Batch Processing

```javascript
// Collect packets for batch processing
const packets = [];
encoder.on('packet', (packet_buffer) => {
    packets.push(packet_buffer);
});

// Encode multiple messages
encoder.encode_message(Buffer.from('Message 1'), 1);
encoder.encode_message(Buffer.from('Message 2'), 1);
encoder.encode_message(Buffer.from('Message 3'), 1);

// Process all packets at once
await decoder.decode_packets_batch(packets, 10);
```

## Protocol Details

### Header Format (12 bytes)

```
 0         1         2         3         4         5         6
 +---------+---------+---------+---------+---------+---------+
 |  Magic  |Ver|Type |    Message ID     |    Fragment Idx   |
 +---------+---------+---------+---------+---------+---------+
 |    Fragment Cnt   |               Source ID               |
 +---------+---------+---------+---------+---------+---------+
 |                                                           |
 |                          Payload                          |
 |                                                           |
 +---------+---------+---------+---------+---------+---------+
```

- **Magic** (1 byte): 0x4A ("J" in ASCII)
- **Ver|Type** (1 byte): Version (2 bits) + Message Type (6 bits)  
- **Message ID** (2 bytes): Unique per logical message
- **Fragment Idx** (2 bytes): Index of this fragment (0-based)
- **Fragment Cnt** (2 bytes): Total number of fragments
- **Source ID** (4 bytes): Source identifier

### Fragmentation

- Maximum payload per packet: 1200 bytes (the maximum will be achieved for all non-terminal fragments)
- Large messages automatically fragmented
- Maximum 65,535 fragments per message
- Fragments can arrive out of order
- Duplicate fragments are rejected

### Message ID Wraparound

- 16-bit message IDs (0-65535)
- Automatic wraparound handling
- Assumes messages within 32768 IDs are in sequence

## Testing

```bash
npm test              # Run tests
npm run test:watch    # Run tests in watch mode
```

## License

ISC
