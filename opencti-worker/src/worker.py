# coding: utf-8

import logging
import yaml
import pika
import os
import time
import requests
import json
import base64
import threading
import ctypes

from requests.auth import HTTPBasicAuth
from pycti import OpenCTIApiClient

EXCHANGE_NAME = 'amqp.worker.exchange'


class Consumer(threading.Thread):
    def __init__(self, connector, api):
        threading.Thread.__init__(self)
        self.api = api
        self.queue_name = connector['config']['push']
        self.pika_connection = pika.BlockingConnection(pika.URLParameters(connector['config']['uri']))
        self.push_channel = self.pika_connection.channel()
        self.push_channel.basic_qos(prefetch_count=1)

    def get_id(self):
        if hasattr(self, '_thread_id'):
            return self._thread_id
        for id, thread in threading._active.items():
            if thread is self:
                return id

    def terminate(self):
        thread_id = self.get_id()
        res = ctypes.pythonapi.PyThreadState_SetAsyncExc(thread_id, ctypes.py_object(SystemExit))
        if res > 1:
            ctypes.pythonapi.PyThreadState_SetAsyncExc(thread_id, 0)
            logging.info('Unable to kill the thread')

    # Callable for consuming a message
    def _process_message(self, channel, method, properties, body):
        data = json.loads(body)
        logging.info('Processing a new message (delivery_tag=' + str(method.delivery_tag) + '), launching a thread...')
        thread = threading.Thread(target=self.data_handler, args=[data])
        thread.start()

        while thread.is_alive():  # Loop while the thread is processing
            self.pika_connection.sleep(1.0)
        logging.info('Message (delivery_tag=' + str(method.delivery_tag) + ') processed, thread terminated')
        self.push_channel.basic_ack(delivery_tag=method.delivery_tag)

    # Data handling
    def data_handler(self, data):
        try:
            content = base64.b64decode(data['content']).decode('utf-8')
            self.api.stix2_import_bundle(content, True, data['entities_types'] if 'entities_types' in data else [])
        except Exception as e:
            logging.error('An unexpected error occurred: { ' + str(e) + ' }')
            return False

    def run(self):
        try:
            # Consume the queue
            logging.info('Thread for queue ' + self.queue_name + ' started')
            self.push_channel.basic_consume(queue=self.queue_name, on_message_callback=self._process_message)
            self.push_channel.start_consuming()
        finally:
            self.push_channel.stop_consuming()
            logging.info('Thread for queue ' + self.queue_name + ' terminated')


class Worker:
    def __init__(self):
        self.consumer_threads = {}

        # Get configuration
        config_file_path = os.path.dirname(os.path.abspath(__file__)) + '/config.yml'
        config = yaml.load(open(config_file_path), Loader=yaml.FullLoader)
        self.log_level = os.getenv('WORKER_LOG_LEVEL') or config['worker']['log_level']
        self.opencti_url = os.getenv('OPENCTI_URL') or config['opencti']['url']
        self.opencti_token = os.getenv('OPENCTI_TOKEN') or config['opencti']['token']

        # Check if openCTI is available
        self.api = OpenCTIApiClient(self.opencti_url, self.opencti_token)

        # Fetch queue configuration from API
        self.connectors = self.api.connectors()
        self.queues = list(map(lambda x: x['config']['push'], self.connectors))

        # Configure logger
        numeric_level = getattr(logging, self.log_level.upper(), None)
        if not isinstance(numeric_level, int):
            raise ValueError('Invalid log level: ' + self.log_level)
        logging.basicConfig(level=numeric_level)

    # Start the main loop
    def start(self):
        try:
            while True:
                # Check if all queues are consumed
                for connector in self.connectors:
                    queue = connector['config']['push']
                    if queue in self.consumer_threads:
                        if not self.consumer_threads[queue].is_alive():
                            logging.info('Thread for queue ' + queue + ' not alive, creating a new one...')
                            self.consumer_threads[queue] = Consumer(connector, self.api)
                            self.consumer_threads[queue].start()
                    else:
                        self.consumer_threads[queue] = Consumer(connector, self.api)
                        self.consumer_threads[queue].start()
                # Check if some threads must be stopped
                for thread in list(self.consumer_threads):
                    if thread not in self.queues:
                        logging.info('Queue ' + thread + ' no longer exists, killing thread...')
                        try:
                            self.consumer_threads[thread].terminate()
                            self.consumer_threads.pop(thread, None)
                        except:
                            logging.info('Unable to kill the thread for queue '
                                         + thread + ', an operation is running, keep trying...')
                time.sleep(5)
        except KeyboardInterrupt:
            # Graceful stop
            for thread in self.consumer_threads.keys():
                if thread not in self.queues:
                    self.consumer_threads[thread].terminate()
            exit(0)


if __name__ == '__main__':
    worker = Worker()
    try:
        worker.start()
    except Exception as e:
        logging.error(e)
        exit(1)
