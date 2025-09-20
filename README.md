# JTP - Janky Transfer Protocol

A Node.js library implementing JTP (Janky Transfer Protocol), a UDP-based protocol for streaming variable-length data with automatic fragmentation. Think of it as RTP, but optimized for variable-length payloads instead of fixed-size frames.

## Features

- **Automatic Fragmentation**: Large payloads are automatically split into fragments that fit within UDP packet size limits
- **Multiple Packet Types**: Support for up to 64 different packet types (0-63) with independent message streams
- **Packet Type Filtering**: Decoders can filter for specific packet types at the packet level
- **Generic Payload Support**: Works with any Buffer data - no schema required
- **Event-Driven**: Built on EventEmitter for reactive programming
- **SSRC Filtering**: Source identification for multi-source environments

## Installation

```bash
npm install jtp
```

## Quick Start

```javascript
const { JTPEncoder, JTPDecoder } = require('jtp');

// Create encoder and decoder with the same SSRC
const ssrc = 0x12345678;
const encoder = new JTPEncoder(ssrc);
const decoder = new JTPDecoder(ssrc);

// Set up decoder
decoder.on('data', (buffer, packet_type, metadata) => {
    console.log(`Received ${buffer.length} bytes of type ${packet_type}`);
    console.log(`Data: ${buffer.toString()}`);
});

// Send data
async function sendData() {
    const message = Buffer.from('Hello, JTP!');
    const packet_type = 1;
    
    for await (const packet of encoder.packetize(message, packet_type)) {
        // Send packet over UDP
        decoder.ingest_packet(packet); // Or send via actual UDP socket
    }
}

sendData();
```

## Filtered Decoders

```javascript
// Create decoders that only listen to specific packet types
const control_decoder = new JTPDecoder(ssrc, [1, 2, 3]); // Only control messages
const data_decoder = new JTPDecoder(ssrc, [10, 11, 12]); // Only data messages

control_decoder.on('data', (buffer, packet_type) => {
    console.log(`Control message type ${packet_type}: ${buffer.toString()}`);
});

data_decoder.on('data', (buffer, packet_type) => {
    console.log(`Data message type ${packet_type}: ${buffer.length} bytes`);
});

// Send different packet types
for await (const packet of encoder.packetize(Buffer.from('SYSTEM_READY'), 1)) {
    control_decoder.ingest_packet(packet); // Will receive
    data_decoder.ingest_packet(packet);    // Will be filtered out
}

for await (const packet of encoder.packetize(Buffer.from('sensor data'), 10)) {
    control_decoder.ingest_packet(packet); // Will be filtered out
    data_decoder.ingest_packet(packet);    // Will receive
}
```

## API Reference

### JTPEncoder

#### Constructor

```javascript
const encoder = new JTPEncoder(ssrc)
```

- `ssrc` (number): 32-bit source identifier

#### Static Properties

- `JTPEncoder.VERSION`: Protocol version (currently 0)
- `JTPEncoder.MAX_PAYLOAD_SIZE`: Maximum payload size per packet (1200 bytes)

#### Methods

##### `packetize(payload_buffer, packet_type)`

Asynchronous generator that yields UDP packets for the given data.

```javascript
const buffer = Buffer.from('Your data here');
const packet_type = 5;

for await (const packet of encoder.packetize(buffer, packet_type)) {
    // Send packet over UDP
    udpSocket.send(packet, port, host);
}
```

- `payload_buffer` (Buffer): The data to send
- `packet_type` (number): Packet type (0-63)
- Returns: AsyncGenerator<Buffer>

##### `packetize_all(payload_buffer, packet_type)`

Convenience method that returns all packets as an array.

```javascript
const packets = await encoder.packetize_all(buffer, packet_type);
packets.forEach(packet => udpSocket.send(packet, port, host));
```

### JTPDecoder

#### Constructor

```javascript
const decoder = new JTPDecoder(ssrc, packet_types = null)
```

- `ssrc` (number): 32-bit source identifier to listen for
- `packet_types` (Array<number>, optional): Array of packet types to accept. If null, accepts all types.

#### Static Properties

- `JTPDecoder.VERSION`: Protocol version (currently 0)
- `JTPDecoder.MAX_PAYLOAD_SIZE`: Maximum payload size per packet (1200 bytes)

#### Methods

##### `ingest_packet(packet)`

Process a received UDP packet. Synchronous.

```javascript
udpSocket.on('message', (packet) => {
    decoder.ingest_packet(packet);
});
```

##### `ingest_packet_async(packet)`

Process a received UDP packet asynchronously (yields to event loop).

```javascript
udpSocket.on('message', async (packet) => {
    await decoder.ingest_packet_async(packet);
});
```

##### `ingest_packets_batch(packets, batch_size = 50)`

Process multiple packets in batches to avoid blocking the event loop.

```javascript
await decoder.ingest_packets_batch(packet_array, 50);
```

##### `reset_accumulator(packet_type = null)`

Clear message accumulator(s).

```javascript
decoder.reset_accumulator();      // Clear all
decoder.reset_accumulator(5);     // Clear specific packet type
```

#### Events

##### `data`

Emitted when a complete message is received.

```javascript
decoder.on('data', (buffer, packet_type, metadata) => {
    // buffer: Buffer containing the complete message
    // packet_type: number (0-63)
    // metadata: { message_id, fragment_count, total_bytes }
});
```

##### `message_start`

Emitted when the first fragment of a new message is received.

```javascript
decoder.on('message_start', ({ packet_type, message_id, fragment_count }) => {
    console.log(`Starting message ${message_id} with ${fragment_count} fragments`);
});
```

##### `fragment_received`

Emitted when each fragment is received.

```javascript
decoder.on('fragment_received', ({ packet_type, message_id, fragment_index, fragment_count, fragments_received }) => {
    console.log(`Fragment ${fragment_index}/${fragment_count - 1} received`);
});
```

##### `message_complete`

Emitted when a message is fully reassembled.

```javascript
decoder.on('message_complete', ({ packet_type, message_id, fragment_count, total_bytes }) => {
    console.log(`Message ${message_id} complete: ${total_bytes} bytes`);
});
```

##### `message_incomplete`

Emitted when a newer message starts before the previous one is complete.

```javascript
decoder.on('message_incomplete', ({ packet_type, message_id, fragments_received, fragment_count }) => {
    console.log(`Message ${message_id} incomplete: ${fragments_received}/${fragment_count}`);
});
```

##### `error`

Emitted on protocol errors.

```javascript
decoder.on('error', (error) => {
    console.error('JTP Error:', error.message);
});
```
## Protocol Details

### Header Format (12 bytes)

```
 0         1         2         3         4         5         6
 +---------+---------+---------+---------+---------+---------+
 |  Magic  |Ver|Type |    Message ID     |    Fragment Idx   |
 +---------+---------+---------+---------+---------+---------+
 |    Fragment Cnt   |                  SSRC                 |
 +---------+---------+---------+---------+---------+---------+
 |                                                           |
 |                          Payload                          |
 |                                                           |
 +---------+---------+---------+---------+---------+---------+
```

- **Magic** (1 byte): 0x4A ("J" in ASCII)
- **Ver|Type** (1 byte): Version (2 bits) + Packet Type (6 bits)
- **Message ID** (2 bytes): Unique per logical message
- **Fragment Idx** (2 bytes): Index of this fragment (0-based)
- **Fragment Cnt** (2 bytes): Total number of fragments
- **SSRC** (4 bytes): Source identifier

### Fragmentation

- Maximum payload per packet: 1200 bytes
- Large messages automatically fragmented
- Maximum 65,535 fragments per message
- Fragments can arrive out of order
- Duplicate fragments are rejected

### Message ID Wraparound

- 16-bit message IDs (0-65535)
- Automatic wraparound handling
- Assumes messages within 32768 IDs are in sequence

## Architecture Benefits

The split architecture provides several advantages over a monolithic stream class:

- **🎯 Focused Responsibility**: Encoder only handles packetization, Decoder only handles reassembly
- **🔍 Efficient Filtering**: Packet type and SSRC filtering at the packet level
- **🚀 Better Performance**: No need to process unwanted packet types
- **🧹 Cleaner API**: Clear separation between sending and receiving logic
- **📊 Independent Streams**: Multiple decoders can handle different message types independently

## Examples

See `example.js` for a complete demonstration including:
- Single packet messages
- Multi-fragment messages  
- Multiple packet types with filtering
- Multiple SSRCs (sources)
- Split architecture usage patterns

## Testing

```bash
npm test              # Run tests
npm run test:watch    # Run tests in watch mode
```

## License

ISC
