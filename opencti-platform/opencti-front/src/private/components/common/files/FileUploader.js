import React, { useRef } from 'react';
import * as PropTypes from 'prop-types';
import { includes, map } from 'ramda';
import graphql from 'babel-plugin-relay/macro';
import { CloudUpload } from '@material-ui/icons';
import IconButton from '@material-ui/core/IconButton';
import { ConnectionHandler } from 'relay-runtime';
import Tooltip from '@material-ui/core/Tooltip';
import { commitMutation, MESSAGING$ } from '../../../../relay/environment';

const FileUploaderMutation = graphql`
  mutation FileUploaderMutation($input: FileUpload) {
    uploadFile(input: $input) {
      ...FileLine_file
    }
  }
`;

const FileUploader = (props) => {
  const { entityId } = props;
  const uploadRef = useRef(null);
  const handleOpenUpload = () => uploadRef.current.click();
  const handleUpload = (file) => {
    commitMutation({
      mutation: FileUploaderMutation,
      variables: { input: { file, entityId } },
      optimisticUpdater: (store) => {
        const idFile = `root:file:${Math.random() * 1000}`;
        const idMeta = `root:meta:${Math.random() * 1000}`;
        const fileNode = store.create(idFile, 'File');
        fileNode.setValue(idFile, 'id');
        fileNode.setValue(file.name, 'name');
        fileNode.setValue('inProgress', 'uploadStatus');
        const metaNode = store.create(idMeta, 'metaData');
        metaNode.setValue('import', 'category');
        metaNode.setValue('-', 'mimetype');
        fileNode.setLinkedRecord(metaNode, 'metaData');
        const newEdge = store.create(
          `client:fileEdge:${Math.random() * 1000}`,
          'FileEdge',
        );
        newEdge.setLinkedRecord(fileNode, 'node');
        const entity = store.get(entityId);
        const conn = ConnectionHandler.getConnection(entity, 'Pagination_importFiles');
        ConnectionHandler.insertEdgeBefore(conn, newEdge);
      },
      updater: (store) => {
        const payload = store.getRootField('uploadFile');
        const newEdge = payload.setLinkedRecord(payload, 'node');
        const entity = store.get(entityId);
        const conn = ConnectionHandler.getConnection(entity, 'Pagination_importFiles');
        // Insert element only if not exists in the current listing
        const fileId = payload.getDataID();
        const edges = conn.getLinkedRecords('edges');
        const ids = map(r => r.getLinkedRecord('node').getValue('id'), edges);
        if (!includes(fileId, ids)) {
          ConnectionHandler.insertEdgeBefore(conn, newEdge);
        }
      },
      onCompleted: () => {
        uploadRef.current.value = null; // Reset the upload input
        MESSAGING$.notifySuccess('File successfully uploaded');
      },
    });
  };
  return <React.Fragment>
    <input ref={uploadRef} type="file" style={{ display: 'none' }}
      onChange={({ target: { validity, files: [file] } }) =>
        // eslint-disable-next-line implicit-arrow-linebreak
        validity.valid && handleUpload(file)
    }/>
    <Tooltip title="Select your file" aria-label="Select your file">
      <IconButton onClick={handleOpenUpload} aria-haspopup="true" color="primary">
        <CloudUpload/>
      </IconButton>
    </Tooltip>
</React.Fragment>;
};

FileUploader.propTypes = {
  entityId: PropTypes.string,
};

export default FileUploader;
