import React, { Component } from 'react';
import * as PropTypes from 'prop-types';
import { withRouter, Link } from 'react-router-dom';
import { compose } from 'ramda';
import { withStyles } from '@material-ui/core/styles';
import Button from '@material-ui/core/Button';
import inject18n from '../../../components/i18n';

const styles = theme => ({
  button: {
    marginRight: theme.spacing.unit,
    padding: '2px 5px 2px 5px',
    minHeight: 20,
    textTransform: 'none',
  },
});

class TopMenuReports extends Component {
  render() {
    const { t, location, classes } = this.props;
    return (
      <div>
        <Button component={Link} to='/dashboard/reports/all' variant={location.pathname === '/dashboard/reports/all' ? 'contained' : 'text'} size="small" color={location.pathname === '/dashboard/reports/all' ? 'primary' : 'inherit'} classes={{ root: classes.button }}>
          {t('All reports')}
        </Button>
        <Button component={Link} to='/dashboard/reports/internal' variant={location.pathname === '/dashboard/reports/internal' ? 'contained' : 'text'} size="small" color={location.pathname === '/dashboard/reports/internal' ? 'primary' : 'inherit'} classes={{ root: classes.button }}>
          {t('Internal productions')}
        </Button>
        <Button component={Link} to='/dashboard/reports/sources' variant={location.pathname === '/dashboard/reports/sources' ? 'contained' : 'text'} size="small" color={location.pathname === '/dashboard/reports/sources' ? 'primary' : 'inherit'} classes={{ root: classes.button }}>
          {t('External sources')}
        </Button>
      </div>
    );
  }
}

TopMenuReports.propTypes = {
  classes: PropTypes.object,
  location: PropTypes.object,
  t: PropTypes.func,
  history: PropTypes.object,
};

export default compose(
  inject18n,
  withRouter,
  withStyles(styles),
)(TopMenuReports);