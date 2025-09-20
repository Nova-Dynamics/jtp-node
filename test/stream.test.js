const { expect } = require('chai');
const { EventEmitter } = require('events');
const { JTPEncoder, JTPDecoder } = require('../index');

describe('JTP Library', () => {
    const test_ssrc = 0x12345678;

    describe('JTPEncoder', () => {
        let encoder;

        beforeEach(() => {
            encoder = new JTPEncoder(test_ssrc);
        });

        describe('Constructor', () => {
            it('should create instance with correct ssrc', () => {
                expect(encoder.ssrc).to.equal(test_ssrc);
                expect(encoder.message_id).to.equal(0);
            });

            it('should initialize buffer pool', () => {
                expect(encoder._buffer_pool).to.be.an('array');
            });
        });

        describe('Static properties', () => {
            it('should have correct VERSION', () => {
                expect(JTPEncoder.VERSION).to.equal(0);
            });

            it('should have correct MAX_PAYLOAD_SIZE', () => {
                expect(JTPEncoder.MAX_PAYLOAD_SIZE).to.equal(1200);
            });
        });

        describe('increment_message_id', () => {
            it('should increment message_id', () => {
                encoder.increment_message_id();
                expect(encoder.message_id).to.equal(1);
            });

            it('should wrap around at 0xFFFF', () => {
                encoder.message_id = 0xFFFF;
                encoder.increment_message_id();
                expect(encoder.message_id).to.equal(0);
            });
        });

        describe('packetize', () => {
            it('should validate packet_type range', async () => {
                const buffer = Buffer.from('test data');
                
                try {
                    for await (const packet of encoder.packetize(buffer, -1)) {
                        // Should not reach here
                    }
                    throw new Error('Should have thrown');
                } catch (error) {
                    expect(error.message).to.equal('Packet type must be 0-63, got -1');
                }

                try {
                    for await (const packet of encoder.packetize(buffer, 64)) {
                        // Should not reach here
                    }
                    throw new Error('Should have thrown');
                } catch (error) {
                    expect(error.message).to.equal('Packet type must be 0-63, got 64');
                }
            });

            it('should validate buffer input', async () => {
                try {
                    for await (const packet of encoder.packetize('not a buffer', 0)) {
                        // Should not reach here
                    }
                    throw new Error('Should have thrown');
                } catch (error) {
                    expect(error.message).to.equal('payload_buffer must be a Buffer');
                }
            });

            it('should create single packet for small data', async () => {
                const test_data = Buffer.from('Hello, World!');
                const packet_type = 5;
                const packets = [];

                for await (const packet of encoder.packetize(test_data, packet_type)) {
                    packets.push(packet);
                }

                expect(packets.length).to.equal(1);
                
                const packet = packets[0];
                expect(packet.length).to.equal(12 + test_data.length);
                
                // Check header
                expect(packet.readUInt8(0)).to.equal(0x4A); // Magic
                expect(packet.readUInt8(1)).to.equal((0 << 6) | packet_type); // Version + Type
                expect(packet.readUInt16LE(2)).to.equal(0); // Message ID
                expect(packet.readUInt16LE(4)).to.equal(0); // Fragment Index
                expect(packet.readUInt16LE(6)).to.equal(1); // Fragment Count
                expect(packet.readUInt32LE(8)).to.equal(test_ssrc); // SSRC
                
                // Check payload
                expect(packet.subarray(12)).to.deep.equal(test_data);
            });

            it('should fragment large data', async () => {
                const large_data = Buffer.alloc(2500, 'A'); // Larger than MAX_PAYLOAD_SIZE
                const packet_type = 10;
                const packets = [];

                for await (const packet of encoder.packetize(large_data, packet_type)) {
                    packets.push(packet);
                }

                const expected_fragments = Math.ceil(2500 / JTPEncoder.MAX_PAYLOAD_SIZE);
                expect(packets.length).to.equal(expected_fragments);

                // Check each fragment
                let total_payload = Buffer.alloc(0);
                for (let i = 0; i < packets.length; i++) {
                    const packet = packets[i];
                    
                    // Check header
                    expect(packet.readUInt8(0)).to.equal(0x4A); // Magic
                    expect(packet.readUInt8(1)).to.equal((0 << 6) | packet_type); // Version + Type
                    expect(packet.readUInt16LE(2)).to.equal(0); // Message ID
                    expect(packet.readUInt16LE(4)).to.equal(i); // Fragment Index
                    expect(packet.readUInt16LE(6)).to.equal(expected_fragments); // Fragment Count
                    expect(packet.readUInt32LE(8)).to.equal(test_ssrc); // SSRC
                    
                    // Accumulate payload
                    total_payload = Buffer.concat([total_payload, packet.subarray(12)]);
                }

                expect(total_payload).to.deep.equal(large_data);
            });

            it('should increment message_id between calls', async () => {
                const buffer = Buffer.from('test');
                const packets1 = [];
                const packets2 = [];

                for await (const packet of encoder.packetize(buffer, 0)) {
                    packets1.push(packet);
                }

                for await (const packet of encoder.packetize(buffer, 0)) {
                    packets2.push(packet);
                }

                expect(packets1[0].readUInt16LE(2)).to.equal(0); // First message
                expect(packets2[0].readUInt16LE(2)).to.equal(1); // Second message
            });

            it('should reject data too large to fragment', async () => {
                // Create data that would require more than 65535 fragments
                const huge_size = 0xFFFF * JTPEncoder.MAX_PAYLOAD_SIZE + 1;
                const huge_data = Buffer.alloc(huge_size);

                try {
                    for await (const packet of encoder.packetize(huge_data, 0)) {
                        // Should not reach here
                    }
                    throw new Error('Should have thrown');
                } catch (error) {
                    expect(error.message).to.equal('Data too large to fragment within 65535 fragments');
                }
            });
        });

        describe('packetize_all', () => {
            it('should return array of all packets', async () => {
                const buffer = Buffer.from('test data');
                const packets = await encoder.packetize_all(buffer, 0);
                
                expect(packets).to.be.an('array');
                expect(packets.length).to.equal(1);
                expect(Buffer.isBuffer(packets[0])).to.be.true;
            });
        });
    });

    describe('JTPDecoder', () => {
        let decoder;

        beforeEach(() => {
            decoder = new JTPDecoder(test_ssrc);
        });

        describe('Constructor', () => {
            it('should create instance with correct ssrc', () => {
                expect(decoder.ssrc).to.equal(test_ssrc);
                expect(decoder).to.be.instanceOf(EventEmitter);
            });

            it('should initialize accumulators', () => {
                expect(decoder._accumulators).to.be.instanceOf(Map);
                expect(decoder._accumulators.size).to.equal(0);
            });

            it('should handle packet type filtering', () => {
                const filtered_decoder = new JTPDecoder(test_ssrc, [1, 2, 3]);
                expect(filtered_decoder.packet_types).to.be.instanceOf(Set);
                expect(filtered_decoder.packet_types.has(1)).to.be.true;
                expect(filtered_decoder.packet_types.has(4)).to.be.false;

                const unfiltered_decoder = new JTPDecoder(test_ssrc);
                expect(unfiltered_decoder.packet_types).to.be.null;
            });
        });

        describe('Static properties', () => {
            it('should have correct VERSION', () => {
                expect(JTPDecoder.VERSION).to.equal(0);
            });

            it('should have correct MAX_PAYLOAD_SIZE', () => {
                expect(JTPDecoder.MAX_PAYLOAD_SIZE).to.equal(1200);
            });
        });

        describe('reset_accumulator', () => {
            it('should clear all accumulators when no packet_type provided', () => {
                decoder._accumulators.set(1, { test: 'data' });
                decoder._accumulators.set(2, { test: 'data' });
                decoder.reset_accumulator();
                expect(decoder._accumulators.size).to.equal(0);
            });

            it('should clear specific accumulator when packet_type provided', () => {
                decoder._accumulators.set(1, { test: 'data' });
                decoder._accumulators.set(2, { test: 'data' });
                decoder.reset_accumulator(1);
                expect(decoder._accumulators.has(1)).to.be.false;
                expect(decoder._accumulators.has(2)).to.be.true;
            });
        });

        describe('ingest_packet', () => {
            let test_events;

            beforeEach(() => {
                test_events = {
                    data: [],
                    message_start: [],
                    message_complete: [],
                    fragment_received: [],
                    message_incomplete: [],
                    error: []
                };

                Object.keys(test_events).forEach(event => {
                    decoder.on(event, (...args) => {
                        test_events[event].push(args);
                    });
                });
            });

            it('should ignore non-JTP packets', () => {
                const invalid_packet = Buffer.from([0x00, 0x01, 0x02]); // Wrong magic
                decoder.ingest_packet(invalid_packet);
                expect(test_events.error.length).to.equal(0);
            });

            it('should emit error for short packets', () => {
                const short_packet = Buffer.from([0x4A, 0x00]); // Too short
                decoder.ingest_packet(short_packet);
                expect(test_events.error.length).to.equal(1);
                expect(test_events.error[0][0].message).to.equal('Packet too short');
            });

            it('should emit error for unsupported version', () => {
                const packet = Buffer.alloc(12);
                packet.writeUInt8(0x4A, 0); // Magic
                packet.writeUInt8((1 << 6) | 0, 1); // Version 1 (unsupported)
                decoder.ingest_packet(packet);
                expect(test_events.error.length).to.equal(1);
                expect(test_events.error[0][0].message).to.equal('Unsupported version: 1');
            });

            it('should ignore packets with wrong SSRC', () => {
                const packet = Buffer.alloc(12);
                packet.writeUInt8(0x4A, 0); // Magic
                packet.writeUInt8((0 << 6) | 0, 1); // Version 0, Type 0
                packet.writeUInt32LE(0x87654321, 8); // Wrong SSRC
                decoder.ingest_packet(packet);
                expect(test_events.error.length).to.equal(0);
                expect(test_events.data.length).to.equal(0);
            });

            it('should filter packet types when specified', () => {
                const filtered_decoder = new JTPDecoder(test_ssrc, [1, 2]);
                const events = [];
                filtered_decoder.on('data', (...args) => events.push(args));

                // Create packet with type 1 (should be processed)
                const packet1 = Buffer.alloc(15);
                packet1.writeUInt8(0x4A, 0); // Magic
                packet1.writeUInt8((0 << 6) | 1, 1); // Version 0, Type 1
                packet1.writeUInt16LE(100, 2);
                packet1.writeUInt16LE(0, 4);
                packet1.writeUInt16LE(1, 6);
                packet1.writeUInt32LE(test_ssrc, 8);
                Buffer.from('abc').copy(packet1, 12);

                // Create packet with type 5 (should be filtered)
                const packet2 = Buffer.alloc(15);
                packet2.writeUInt8(0x4A, 0); // Magic
                packet2.writeUInt8((0 << 6) | 5, 1); // Version 0, Type 5
                packet2.writeUInt16LE(101, 2);
                packet2.writeUInt16LE(0, 4);
                packet2.writeUInt16LE(1, 6);
                packet2.writeUInt32LE(test_ssrc, 8);
                Buffer.from('def').copy(packet2, 12);

                filtered_decoder.ingest_packet(packet1);
                filtered_decoder.ingest_packet(packet2);

                expect(events.length).to.equal(1); // Only packet1 should be processed
                expect(events[0][1]).to.equal(1); // packet_type should be 1
            });

            it('should process single fragment message', () => {
                const test_payload = Buffer.from('Hello, World!');
                const packet = Buffer.alloc(12 + test_payload.length);
                
                packet.writeUInt8(0x4A, 0); // Magic
                packet.writeUInt8((0 << 6) | 5, 1); // Version 0, Type 5
                packet.writeUInt16LE(100, 2); // Message ID
                packet.writeUInt16LE(0, 4); // Fragment Index
                packet.writeUInt16LE(1, 6); // Fragment Count
                packet.writeUInt32LE(test_ssrc, 8); // SSRC
                test_payload.copy(packet, 12);

                decoder.ingest_packet(packet);

                expect(test_events.message_start.length).to.equal(1);
                expect(test_events.message_start[0][0]).to.deep.equal({
                    packet_type: 5,
                    message_id: 100,
                    fragment_count: 1
                });

                expect(test_events.fragment_received.length).to.equal(1);
                expect(test_events.fragment_received[0][0]).to.deep.equal({
                    packet_type: 5,
                    message_id: 100,
                    fragment_index: 0,
                    fragment_count: 1,
                    fragments_received: 1
                });

                expect(test_events.data.length).to.equal(1);
                expect(test_events.data[0][0]).to.deep.equal(test_payload);
                expect(test_events.data[0][1]).to.equal(5); // packet_type
                expect(test_events.data[0][2]).to.deep.equal({
                    message_id: 100,
                    fragment_count: 1,
                    total_bytes: test_payload.length
                });

                expect(test_events.message_complete.length).to.equal(1);
                expect(test_events.message_complete[0][0]).to.deep.equal({
                    packet_type: 5,
                    message_id: 100,
                    fragment_count: 1,
                    total_bytes: test_payload.length
                });
            });

            it('should handle multiple packet types independently', () => {
                const payload1 = Buffer.from('Type 1 data');
                const payload2 = Buffer.from('Type 2 data');
                
                // Create packets for different types
                const packet1 = Buffer.alloc(12 + payload1.length);
                packet1.writeUInt8(0x4A, 0);
                packet1.writeUInt8((0 << 6) | 1, 1); // Type 1
                packet1.writeUInt16LE(100, 2);
                packet1.writeUInt16LE(0, 4);
                packet1.writeUInt16LE(1, 6);
                packet1.writeUInt32LE(test_ssrc, 8);
                payload1.copy(packet1, 12);

                const packet2 = Buffer.alloc(12 + payload2.length);
                packet2.writeUInt8(0x4A, 0);
                packet2.writeUInt8((0 << 6) | 2, 1); // Type 2
                packet2.writeUInt16LE(200, 2);
                packet2.writeUInt16LE(0, 4);
                packet2.writeUInt16LE(1, 6);
                packet2.writeUInt32LE(test_ssrc, 8);
                payload2.copy(packet2, 12);

                decoder.ingest_packet(packet1);
                decoder.ingest_packet(packet2);

                expect(test_events.data.length).to.equal(2);
                expect(test_events.data[0][0]).to.deep.equal(payload1);
                expect(test_events.data[0][1]).to.equal(1);
                expect(test_events.data[1][0]).to.deep.equal(payload2);
                expect(test_events.data[1][1]).to.equal(2);
            });

            it('should reassemble fragmented messages', () => {
                const fragment1 = Buffer.from('Hello, ');
                const fragment2 = Buffer.from('World!');
                
                // First fragment
                const packet1 = Buffer.alloc(12 + fragment1.length);
                packet1.writeUInt8(0x4A, 0);
                packet1.writeUInt8((0 << 6) | 0, 1);
                packet1.writeUInt16LE(100, 2);
                packet1.writeUInt16LE(0, 4); // Fragment 0
                packet1.writeUInt16LE(2, 6); // 2 fragments total
                packet1.writeUInt32LE(test_ssrc, 8);
                fragment1.copy(packet1, 12);

                // Second fragment
                const packet2 = Buffer.alloc(12 + fragment2.length);
                packet2.writeUInt8(0x4A, 0);
                packet2.writeUInt8((0 << 6) | 0, 1);
                packet2.writeUInt16LE(100, 2);
                packet2.writeUInt16LE(1, 4); // Fragment 1
                packet2.writeUInt16LE(2, 6); // 2 fragments total
                packet2.writeUInt32LE(test_ssrc, 8);
                fragment2.copy(packet2, 12);

                decoder.ingest_packet(packet1);
                expect(test_events.data.length).to.equal(0); // Not complete yet

                decoder.ingest_packet(packet2);
                expect(test_events.data.length).to.equal(1);
                expect(test_events.data[0][0]).to.deep.equal(Buffer.concat([fragment1, fragment2]));
            });

            it('should emit error for duplicate fragments', () => {
                const fragment = Buffer.from('test');
                const packet = Buffer.alloc(12 + fragment.length);
                
                packet.writeUInt8(0x4A, 0);
                packet.writeUInt8((0 << 6) | 0, 1);
                packet.writeUInt16LE(100, 2);
                packet.writeUInt16LE(0, 4);
                packet.writeUInt16LE(2, 6);
                packet.writeUInt32LE(test_ssrc, 8);
                fragment.copy(packet, 12);

                decoder.ingest_packet(packet);
                expect(test_events.error.length).to.equal(0);

                decoder.ingest_packet(packet); // Duplicate
                expect(test_events.error.length).to.equal(1);
                expect(test_events.error[0][0].message).to.include('Duplicate fragment');
            });

            it('should emit message_incomplete when starting newer message', () => {
                const fragment = Buffer.from('incomplete');
                const packet1 = Buffer.alloc(12 + fragment.length);
                
                packet1.writeUInt8(0x4A, 0);
                packet1.writeUInt8((0 << 6) | 0, 1);
                packet1.writeUInt16LE(100, 2);
                packet1.writeUInt16LE(0, 4);
                packet1.writeUInt16LE(2, 6); // 2 fragments expected
                packet1.writeUInt32LE(test_ssrc, 8);
                fragment.copy(packet1, 12);

                // Start new message before completing first
                const packet2 = Buffer.alloc(12 + fragment.length);
                packet2.writeUInt8(0x4A, 0);
                packet2.writeUInt8((0 << 6) | 0, 1);
                packet2.writeUInt16LE(101, 2); // Newer message
                packet2.writeUInt16LE(0, 4);
                packet2.writeUInt16LE(1, 6);
                packet2.writeUInt32LE(test_ssrc, 8);
                fragment.copy(packet2, 12);

                decoder.ingest_packet(packet1);
                decoder.ingest_packet(packet2);

                expect(test_events.message_incomplete.length).to.equal(1);
                expect(test_events.message_incomplete[0][0]).to.deep.equal({
                    packet_type: 0,
                    message_id: 100,
                    fragments_received: 1,
                    fragment_count: 2
                });
            });
        });

        describe('ingest_packet_async', () => {
            it('should process packet asynchronously', async () => {
                const test_payload = Buffer.from('async test');
                const packet = Buffer.alloc(12 + test_payload.length);
                
                packet.writeUInt8(0x4A, 0);
                packet.writeUInt8((0 << 6) | 0, 1);
                packet.writeUInt16LE(100, 2);
                packet.writeUInt16LE(0, 4);
                packet.writeUInt16LE(1, 6);
                packet.writeUInt32LE(test_ssrc, 8);
                test_payload.copy(packet, 12);

                const events = [];
                decoder.on('data', (...args) => events.push(args));

                await decoder.ingest_packet_async(packet);
                
                expect(events.length).to.equal(1);
                expect(events[0][0]).to.deep.equal(test_payload);
            });
        });

        describe('ingest_packets_batch', () => {
            it('should process packets in batches', async () => {
                const packets = [];
                const events = [];
                
                decoder.on('data', (...args) => events.push(args));

                // Create 5 packets
                for (let i = 0; i < 5; i++) {
                    const payload = Buffer.from(`packet ${i}`);
                    const packet = Buffer.alloc(12 + payload.length);
                    
                    packet.writeUInt8(0x4A, 0);
                    packet.writeUInt8((0 << 6) | 0, 1);
                    packet.writeUInt16LE(i, 2);
                    packet.writeUInt16LE(0, 4);
                    packet.writeUInt16LE(1, 6);
                    packet.writeUInt32LE(test_ssrc, 8);
                    payload.copy(packet, 12);
                    
                    packets.push(packet);
                }

                await decoder.ingest_packets_batch(packets, 2); // Batch size 2
                
                expect(events.length).to.equal(5);
            });
        });
    });

    describe('Integration tests', () => {
        it('should roundtrip data correctly', async () => {
            const original_data = Buffer.from('This is a test message that should be fragmented and reassembled correctly!');
            const packet_type = 7;
            
            const encoder = new JTPEncoder(test_ssrc);
            const decoder = new JTPDecoder(test_ssrc);
            
            // Packetize
            const packets = await encoder.packetize_all(original_data, packet_type);
            
            const received_data = [];
            decoder.on('data', (buffer, type, metadata) => {
                received_data.push({ buffer, type, metadata });
            });

            // Ingest all packets
            for (const packet of packets) {
                decoder.ingest_packet(packet);
            }

            expect(received_data.length).to.equal(1);
            expect(received_data[0].buffer).to.deep.equal(original_data);
            expect(received_data[0].type).to.equal(packet_type);
            expect(received_data[0].metadata.total_bytes).to.equal(original_data.length);
        });

        it('should handle multiple packet types with filtering', async () => {
            const encoder = new JTPEncoder(test_ssrc);
            const control_decoder = new JTPDecoder(test_ssrc, [1, 2]); // Only control messages
            const data_decoder = new JTPDecoder(test_ssrc, [10, 11]); // Only data messages
            
            const control_messages = [];
            const data_messages = [];
            
            control_decoder.on('data', (buffer, type) => {
                control_messages.push({ buffer, type });
            });
            
            data_decoder.on('data', (buffer, type) => {
                data_messages.push({ buffer, type });
            });

            // Send various message types
            const messages = [
                { data: Buffer.from('control1'), type: 1 },
                { data: Buffer.from('data1'), type: 10 },
                { data: Buffer.from('control2'), type: 2 },
                { data: Buffer.from('ignored'), type: 5 }, // Should be ignored by both
                { data: Buffer.from('data2'), type: 11 }
            ];

            for (const msg of messages) {
                const packets = await encoder.packetize_all(msg.data, msg.type);
                for (const packet of packets) {
                    control_decoder.ingest_packet(packet);
                    data_decoder.ingest_packet(packet);
                }
            }

            expect(control_messages.length).to.equal(2);
            expect(control_messages[0].type).to.equal(1);
            expect(control_messages[1].type).to.equal(2);
            
            expect(data_messages.length).to.equal(2);
            expect(data_messages[0].type).to.equal(10);
            expect(data_messages[1].type).to.equal(11);
        });
    });
});
