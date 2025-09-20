const { JTPEncoder, JTPDecoder } = require('./index');

// Example usage of JTP (Janky Transfer Protocol) with split architecture

async function example() {
    console.log('JTP Example: Variable-length data streaming with automatic fragmentation\n');
    console.log('New split architecture: JTPEncoder + JTPDecoder\n');

    // Create encoder and decoders with the same SSRC
    const ssrc = 0x12345678;
    const encoder = new JTPEncoder(ssrc);
    
    // Create multiple decoders for different purposes
    const main_decoder = new JTPDecoder(ssrc); // Listen to all packet types
    const control_decoder = new JTPDecoder(ssrc, [1, 2, 3]); // Only control messages
    const data_decoder = new JTPDecoder(ssrc, [10, 11, 12]); // Only data messages

    // Set up main decoder event handlers
    main_decoder.on('message_start', ({ packet_type, message_id, fragment_count }) => {
        console.log(`📥 [MAIN] Starting message: Type=${packet_type}, ID=${message_id}, Fragments=${fragment_count}`);
    });

    main_decoder.on('fragment_received', ({ packet_type, message_id, fragment_index, fragments_received, fragment_count }) => {
        console.log(`  📦 [MAIN] Fragment ${fragment_index}/${fragment_count - 1} received (${fragments_received}/${fragment_count} total)`);
    });

    main_decoder.on('data', (buffer, packet_type, metadata) => {
        console.log(`✅ [MAIN] Complete message received:`);
        console.log(`   Type: ${packet_type}`);
        console.log(`   Size: ${metadata.total_bytes} bytes`);
        const truncated_data = buffer.length > 50 ? buffer.toString().substring(0, 50) + '...' : buffer.toString();
        console.log(`   Data: "${truncated_data}"`);
        console.log('');
    });

    // Set up filtered decoders
    control_decoder.on('data', (buffer, packet_type) => {
        console.log(`🎛️  [CONTROL] Received type ${packet_type}: "${buffer.toString()}"`);
    });

    data_decoder.on('data', (buffer, packet_type) => {
        console.log(`📊 [DATA] Received type ${packet_type}: ${buffer.length} bytes`);
    });

    main_decoder.on('error', (error) => {
        console.error('❌ Error:', error.message);
    });

    // Example 1: Small message (single packet)
    console.log('Example 1: Small control message');
    const small_message = Buffer.from('SYSTEM_READY');
    const packet_type_1 = 1; // Control message type
    
    console.log(`📤 Sending: "${small_message.toString()}" (Type: ${packet_type_1})`);
    
    for await (const packet of encoder.packetize(small_message, packet_type_1)) {
        main_decoder.ingest_packet(packet);
        control_decoder.ingest_packet(packet);
        data_decoder.ingest_packet(packet); // Should be filtered out
    }

    // Example 2: Large data message (multiple fragments)
    console.log('Example 2: Large data message (will be fragmented)');
    const large_message = Buffer.from('D'.repeat(2500)); // Larger than MAX_PAYLOAD_SIZE (1200)
    const packet_type_2 = 10; // Data message type
    
    console.log(`📤 Sending: ${large_message.length} bytes of data (Type: ${packet_type_2})`);
    
    for await (const packet of encoder.packetize(large_message, packet_type_2)) {
        main_decoder.ingest_packet(packet);
        control_decoder.ingest_packet(packet); // Should be filtered out
        data_decoder.ingest_packet(packet);
    }

    // Example 3: Multiple packet types demonstration
    console.log('Example 3: Multiple packet types with filtering');
    
    const messages = [
        { data: Buffer.from('CONFIG_UPDATE'), type: 2, description: 'Control message' },
        { data: Buffer.from(JSON.stringify({ sensor: 'temp', value: 23.5 })), type: 11, description: 'JSON data' },
        { data: Buffer.from('ALERT_CRITICAL'), type: 3, description: 'Control alert' },
        { data: Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]), type: 12, description: 'Binary data' },
        { data: Buffer.from('IGNORED_MESSAGE'), type: 20, description: 'Message filtered by specialized decoders' }
    ];
    
    console.log('📤 Sending multiple message types...');
    
    // Send all messages and distribute to all decoders
    for (const msg of messages) {
        console.log(`   - ${msg.description} (Type: ${msg.type})`);
        const packets = await encoder.packetize_all(msg.data, msg.type);
        
        for (const packet of packets) {
            main_decoder.ingest_packet(packet);
            control_decoder.ingest_packet(packet);
            data_decoder.ingest_packet(packet);
        }
    }

    // Example 4: Demonstrate different SSRCs (separate sources)
    console.log('\nExample 4: Multiple sources (different SSRCs)');
    
    const source2_ssrc = 0x87654321;
    const encoder2 = new JTPEncoder(source2_ssrc);
    const decoder_source2 = new JTPDecoder(source2_ssrc);
    
    decoder_source2.on('data', (buffer, packet_type) => {
        console.log(`🔹 [SOURCE2] Received type ${packet_type}: "${buffer.toString()}"`);
    });
    
    // Send from both sources
    const msg1 = Buffer.from('Message from source 1');
    const msg2 = Buffer.from('Message from source 2');
    
    console.log('📤 Sending from source 1 (SSRC: 0x12345678)');
    for await (const packet of encoder.packetize(msg1, 1)) {
        main_decoder.ingest_packet(packet); // Should receive
        decoder_source2.ingest_packet(packet); // Should be filtered out
    }
    
    console.log('📤 Sending from source 2 (SSRC: 0x87654321)');
    for await (const packet of encoder2.packetize(msg2, 1)) {
        main_decoder.ingest_packet(packet); // Should be filtered out
        decoder_source2.ingest_packet(packet); // Should receive
    }

    console.log('\n🎉 Example completed!');
    console.log('\nKey benefits of split architecture:');
    console.log('• ✅ One encoder per source (SSRC)');
    console.log('• ✅ One decoder per source + optional packet type filtering');
    console.log('• ✅ Efficient filtering at packet level');
    console.log('• ✅ Independent message streams');
    console.log('• ✅ Cleaner separation of concerns');
}

// Run the example
example().catch(console.error);
