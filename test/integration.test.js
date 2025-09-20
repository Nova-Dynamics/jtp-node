/**
 * @fileoverview Integration test suite for JTP Encoder and Decoder
 * @author JTP Library
 * @version 1.0.0
 */

const { expect } = require('chai');
const JTPEncoder = require('../lib/Encoder');
const JTPDecoder = require('../lib/Decoder');

describe('JTP Integration Tests', function() {
    let encoder, decoder;
    const SOURCE_ID = 0x12345678;

    beforeEach(function() {
        encoder = new JTPEncoder({ source_id: SOURCE_ID });
        decoder = new JTPDecoder({ source_id: SOURCE_ID });
    });

    describe('Round-trip Encoding/Decoding', function() {
        it('should handle various message sizes', function(done) {
            const test_cases = [
                { size: 0, name: 'empty' },
                { size: 1, name: 'single byte' },
                { size: 100, name: 'small message' },
                { size: 1200, name: 'single fragment' },
                { size: 2400, name: 'two fragments' },
                { size: 5000, name: 'multiple fragments' }
            ];
            
            let completed_tests = 0;
            
            test_cases.forEach((test_case, index) => {
                const message = Buffer.alloc(test_case.size);
                message.fill(index + 1); // Fill with unique pattern
                const message_type = index;
                
                // Set up decoder for this specific message
                const message_decoder = new JTPDecoder({ source_id: SOURCE_ID, message_types: [message_type] });
                
                message_decoder.on('message', (decoded_buffer, type, metadata) => {
                    expect(decoded_buffer).to.deep.equal(message, `Failed for ${test_case.name}`);
                    expect(type).to.equal(message_type);
                    expect(metadata.total_bytes).to.equal(test_case.size);
                    
                    completed_tests++;
                    if (completed_tests === test_cases.length) {
                        done();
                    }
                });
                
                // Encode and immediately decode
                encoder.on('packet', (packet) => {
                    message_decoder.decode_packet(packet);
                });
                
                encoder.encode_message(message, message_type);
            });
        });

        it('should handle concurrent messages', function(done) {
            const messages = [
                { data: Buffer.from('First message'), type: 1 },
                { data: Buffer.from('Second message'), type: 2 },
                { data: Buffer.from('Third message'), type: 3 }
            ];
            
            const decoded_messages = new Map();
            
            decoder.on('message', (buffer, type, metadata) => {
                decoded_messages.set(type, buffer);
                
                if (decoded_messages.size === messages.length) {
                    messages.forEach(msg => {
                        expect(decoded_messages.get(msg.type)).to.deep.equal(msg.data);
                    });
                    done();
                }
            });
            
            encoder.on('packet', (packet) => {
                decoder.decode_packet(packet);
            });
            
            // Encode all messages
            messages.forEach(msg => {
                encoder.encode_message(msg.data, msg.type);
            });
        });

        it('should handle packet loss simulation', function(done) {
            const message = Buffer.alloc(3000); // Multi-fragment message
            message.fill(0xFF);
            const message_type = 10;
            const packets = [];
            
            // Collect all packets
            encoder.on('packet', (packet) => {
                packets.push(packet);
            });
            
            encoder.on('message:encoded', (metadata) => {
                expect(packets.length).to.be.greaterThan(1); // Should be fragmented
                
                // Simulate 20% packet loss by randomly dropping packets
                const delivered_packets = packets.filter(() => Math.random() > 0.2);
                
                if (delivered_packets.length === packets.length) {
                    // No packets lost, should decode successfully
                    decoder.on('message', (buffer) => {
                        expect(buffer).to.deep.equal(message);
                        done();
                    });
                    
                    delivered_packets.forEach(packet => decoder.decode_packet(packet));
                } else {
                    // Some packets lost, should not complete message
                    let error_received = false;
                    
                    decoder.on('error', () => {
                        error_received = true;
                    });
                    
                    decoder.on('message', () => {
                        throw new Error('Should not receive complete message with packet loss');
                    });
                    
                    // Deliver remaining packets
                    delivered_packets.forEach(packet => decoder.decode_packet(packet));
                    
                    // Wait a bit then check if error was triggered
                    setTimeout(() => {
                        if (!error_received) {
                            done(); // Test passed - incomplete message didn't trigger completion
                        }
                    }, 100);
                }
            });
            
            encoder.encode_message(message, message_type);
        });

        it('should handle packet reordering', function(done) {
            const message = Buffer.alloc(4000); // Ensure multiple fragments
            for (let i = 0; i < message.length; i++) {
                message[i] = i % 256; // Unique pattern
            }
            const message_type = 20;
            const packets = [];
            
            encoder.on('packet', (packet) => {
                packets.push(packet);
            });
            
            encoder.on('message:encoded', () => {
                expect(packets.length).to.be.greaterThan(2);
                
                // Shuffle packets to simulate reordering
                const shuffled_packets = [...packets].sort(() => Math.random() - 0.5);
                
                decoder.on('message', (buffer, type, metadata) => {
                    expect(buffer).to.deep.equal(message);
                    expect(type).to.equal(message_type);
                    done();
                });
                
                // Deliver shuffled packets
                shuffled_packets.forEach(packet => decoder.decode_packet(packet));
            });
            
            encoder.encode_message(message, message_type);
        });
    });

    describe('Error Recovery', function() {
        it('should recover from corrupted packets', function(done) {
            const good_message = Buffer.from('Good message');
            const message_type = 5;
            let good_message_received = false;
            
            decoder.on('message', (buffer, type) => {
                expect(buffer).to.deep.equal(good_message);
                expect(type).to.equal(message_type);
                good_message_received = true;
                done();
            });
            
            decoder.on('error', (error) => {
                // Should receive error for corrupted packet but continue working
                expect(error.message).to.include('Packet too short');
            });
            
            // Send corrupted packet first
            const corrupted_packet = Buffer.alloc(5);
            corrupted_packet.writeUInt8(0x4A, 0); // Valid magic byte but too short
            decoder.decode_packet(corrupted_packet);
            
            // Then send good packet
            encoder.on('packet', (packet) => {
                decoder.decode_packet(packet);
            });
            
            encoder.encode_message(good_message, message_type);
        });

        it('should handle message ID conflicts gracefully', function(done) {
            const message1 = Buffer.from('First message');
            const message2 = Buffer.from('Second message - should replace first');
            const message_type = 7;
            
            // Manually set message ID to create conflict
            encoder.message_id = 100;
            
            let incomplete_received = false;
            
            decoder.on('message:incomplete', (info) => {
                expect(info.message_id).to.equal(100);
                incomplete_received = true;
            });
            
            decoder.on('message', (buffer, type, metadata) => {
                expect(buffer).to.deep.equal(message2);
                expect(metadata.message_id).to.equal(101);
                expect(incomplete_received).to.be.true;
                done();
            });
            
            encoder.on('packet', (packet) => {
                decoder.decode_packet(packet);
            });
            
            // Encode first message (multi-fragment)
            const large_message1 = Buffer.alloc(3000);
            large_message1.fill(0xAA);
            encoder.encode_message(large_message1, message_type);
            
            // Encode second message before first completes
            setTimeout(() => {
                encoder.encode_message(message2, message_type);
            }, 10);
        });
    });

    describe('Performance Characteristics', function() {
        it('should handle large messages efficiently', function(done) {
            this.timeout(5000); // Allow more time for large message
            
            const large_message = Buffer.alloc(100000); // 100KB message
            for (let i = 0; i < large_message.length; i++) {
                large_message[i] = i % 256;
            }
            const message_type = 30;
            
            const start_time = Date.now();
            
            decoder.on('message', (buffer, type, metadata) => {
                const end_time = Date.now();
                const duration = end_time - start_time;
                
                expect(buffer).to.deep.equal(large_message);
                expect(type).to.equal(message_type);
                expect(metadata.total_bytes).to.equal(large_message.length);
                
                // Should complete within reasonable time (less than 1 second)
                expect(duration).to.be.lessThan(1000);
                
                console.log(`      Processed ${large_message.length} bytes in ${duration}ms`);
                done();
            });
            
            encoder.on('packet', (packet) => {
                decoder.decode_packet(packet);
            });
            
            encoder.encode_message(large_message, message_type);
        });

        it('should handle many small messages efficiently', function(done) {
            this.timeout(5000); // Allow more time for many messages
            
            const message_count = 1000;
            const message_size = 50;
            let decoded_count = 0;
            
            const start_time = Date.now();
            
            decoder.on('message', (buffer, type, metadata) => {
                expect(buffer.length).to.equal(message_size);
                expect(type).to.equal(decoded_count % 64); // Cycle through message types
                
                decoded_count++;
                
                if (decoded_count === message_count) {
                    const end_time = Date.now();
                    const duration = end_time - start_time;
                    
                    console.log(`      Processed ${message_count} messages in ${duration}ms`);
                    expect(duration).to.be.lessThan(2000); // Should complete within 2 seconds
                    done();
                }
            });
            
            encoder.on('packet', (packet) => {
                decoder.decode_packet(packet);
            });
            
            // Generate many small messages
            for (let i = 0; i < message_count; i++) {
                const message = Buffer.alloc(message_size);
                message.fill(i % 256);
                encoder.encode_message(message, i % 64);
            }
        });
    });
});
