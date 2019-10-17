import { assoc } from 'ramda';
import { escapeString, getById, getObject, paginate } from '../database/grakn';
import {
  findAll as relationFindAll,
  search as relationSearch
} from './stixRelation';

export const findById = stixEntityId => getById(stixEntityId);

export const markingDefinitions = (stixEntityId, args) => {
  return paginate(
    `match $m isa Marking-Definition; 
    $rel(marking:$m, so:$x) isa object_marking_refs; 
    $x has internal_id "${escapeString(stixEntityId)}"`,
    args,
    false,
    null,
    false,
    false
  );
};

export const tags = (stixEntityId, args) => {
  return paginate(
    `match $t isa Tag; 
    $rel(tagging:$t, so:$x) isa tagged; 
    $x has internal_id "${escapeString(stixEntityId)}"`,
    args,
    false,
    null,
    false,
    false
  );
};

export const createdByRef = stixEntityId => {
  return getObject(
    `match $i isa Identity;
    $rel(creator:$i, so:$x) isa created_by_ref; 
    $x has internal_id "${escapeString(stixEntityId)}"; 
    get; 
    offset 0; 
    limit 1;`,
    'i',
    'rel'
  );
};

export const reports = (stixEntityId, args) => {
  return paginate(
    `match $r isa Report; 
    $rel(knowledge_aggregation:$r, so:$x) isa object_refs; 
    $x has internal_id "${escapeString(stixEntityId)}"`,
    args
  );
};

export const stixRelations = (stixEntityId, args) => {
  const finalArgs = assoc('fromId', stixEntityId, args);
  if (finalArgs.search && finalArgs.search.length > 0) {
    return relationSearch(finalArgs);
  }
  return relationFindAll(finalArgs);
};
