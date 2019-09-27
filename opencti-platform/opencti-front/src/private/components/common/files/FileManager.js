import React from 'react';
import * as PropTypes from 'prop-types';
import graphql from 'babel-plugin-relay/macro';
import { compose } from 'ramda';
import Grid from '@material-ui/core/Grid';
import Typography from '@material-ui/core/Typography';
import Paper from '@material-ui/core/Paper';
import { withStyles } from '@material-ui/core';
import IconButton from '@material-ui/core/IconButton';
import { DonutSmall, DonutLarge } from '@material-ui/icons';
import { ConnectionHandler } from 'relay-runtime';
import Tooltip from '@material-ui/core/Tooltip';
import inject18n from '../../../../components/i18n';
import FileUploader from './FileUploader';
import { commitMutation, MESSAGING$ } from '../../../../relay/environment';
import FileImportViewer from './FileImportViewer';
import FileExportViewer from './FileExportViewer';

const styles = () => ({
  container: {
    margin: 0,
  },
  gridContainer: {
    marginBottom: 20,
  },
  paper: {
    minHeight: '100%',
    margin: '10px 0 0 0',
    padding: '15px',
    borderRadius: 6,
  },
});

export const FileManagerExportMutation = graphql`
    mutation FileManagerExportMutation($id: ID!, $exportType: String!) {
        stixDomainEntityEdit(id: $id) {
            askExport(exportType: $exportType) {
                ...FileLine_file
            }
        }
    }
`;

const FileManager = ({
  id, entity, t, classes,
}) => {
  const askExport = (exportType) => {
    commitMutation({
      mutation: FileManagerExportMutation,
      variables: { id, exportType },
      updater: (store) => {
        const root = store.getRootField('stixDomainEntityEdit');
        const payload = root.getLinkedRecord('askExport', { exportType });
        const newEdge = payload.setLinkedRecord(payload, 'node');
        const entityPage = store.get(id);
        const conn = ConnectionHandler.getConnection(entityPage, 'Pagination_exportFiles');
        ConnectionHandler.insertEdgeBefore(conn, newEdge);
      },
      onCompleted: () => {
        MESSAGING$.notifySuccess('Export successfully started');
      },
    });
  };
  const exportPartial = () => askExport('stix2-bundle-simple');
  const exportComplete = () => askExport('stix2-bundle-full');
  return <div>
        <Grid container={true} spacing={3} classes={{ container: classes.gridContainer }}>
            <Grid item={true} xs={6}>
                <div>
                    <div style={{ float: 'left' }}>
                        <Typography variant="h2" style={{ paddingTop: 15 }} gutterBottom={true}>
                            {t('Uploaded / Imported files')}
                        </Typography>
                    </div>
                    <div style={{ float: 'right' }}>
                        <FileUploader entityId={id}/>
                    </div>
                    <div className="clearfix" />
                </div>
                <Paper classes={{ root: classes.paper }} elevation={2}>
                    <FileImportViewer entity={entity} />
                </Paper>
            </Grid>
            <Grid item={true} xs={6}>
                <div style={{ float: 'left' }}>
                    <Typography variant="h2" style={{ paddingTop: 15 }} gutterBottom={true}>
                        {t('Generated / Exported files')}
                    </Typography>
                </div>
                <div style={{ float: 'right' }}>
                    <Tooltip title="Simple export" aria-label="Simple export">
                        <IconButton onClick={exportPartial} aria-haspopup="true" color="primary">
                            <DonutLarge/>
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Complete export" aria-label="Complete export">
                        <IconButton onClick={exportComplete} aria-haspopup="true" color="primary">
                            <DonutSmall/>
                        </IconButton>
                    </Tooltip>
                </div>
                <div className="clearfix" />
                <Paper classes={{ root: classes.paper }} elevation={2}>
                    <FileExportViewer entity={entity} />
                </Paper>
            </Grid>
        </Grid>
    </div>;
};

FileManager.propTypes = {
  nsdt: PropTypes.func,
  id: PropTypes.string.isRequired,
  entity: PropTypes.object.isRequired,
};

export default compose(
  inject18n,
  withStyles(styles),
)(FileManager);
